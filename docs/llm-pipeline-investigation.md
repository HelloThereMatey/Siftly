# Siftly LLM Pipeline — Investigation & Findings

**Date:** 2026-07-11
**Status:** Findings captured; implementation deferred
**Branch:** `extra_providers`

---

## TL;DR — the headline finding

The configured model, **DeepSeek-V4-Pro, is text-only** — it cannot process images. Because Siftly routes *all three* AI stages (vision, enrichment, categorization) through the single configured provider/model, the **vision step is silently failing on ~92% of images** (325 of 354 media items). Image-bearing tweets are being categorized from tweet text alone, with zero image context — which is why results have been "not great."

The fix the user proposed — a separate image/OCR pipeline using a model that can actually see images (or a dedicated OCR model) — is the correct direction. DeepSeek-V4-Pro is *good* at the text stages and should be kept for those; it just must not be used for vision.

---

## Part 1 — How Siftly feeds tweets to LLMs (current architecture)

### Text and image are already separated at storage

There is **no "image + text blob"** anywhere. At import (`lib/parser.ts`), the tweet JSON is split into:
- `Bookmark.text` — the tweet's text, a plain string pulled from JSON. **Never OCR'd, never vision-processed.**
- `MediaItem` — separate rows, one per image, each holding a `url` (and later `imageTags`).

So the user's desired "image pipeline / text pipeline" split **mostly already exists** in the data model.

### The processing pipeline (`POST /api/categorize`)

Orchestrated in `app/api/categorize/route.ts`. Conceptually:

```
IMPORT (no AI)
  parser.ts → Bookmark.text (plain) + MediaItem rows (image URLs)

STAGE 1 — Entity extraction (DETERMINISTIC, no LLM, free)
  lib/rawjson-extractor.ts mines stored rawJson
  → Bookmark.entities {hashtags[], urls[], mentions[], tools[], tweetType}
  tools detected via KNOWN_TOOL_DOMAINS (~90 domains)

STAGE 2 — Parallel per-tweet (PIPELINE_WORKERS = 5). Per tweet, in sequence:

  (a) VISION  ── image bytes ONLY (base64) ──→ vision model
        lib/vision-analyzer.ts: analyzeItem → analyzeImageWithRetry
        sent:   image base64 + ANALYSIS_PROMPT   (NO tweet text)
        output: MediaItem.imageTags  (text_ocr, objects, scene, mood,
                meme_template, ~35 tags, people, style, action)

  (b) ENRICHMENT  ── text ONLY ──→ text LLM
        lib/vision-analyzer.ts: enrichBatchSemanticTags
        sent:   tweet text (≤500 chars) + flattened image context + hashtags/mentions
        output: Bookmark.semanticTags + Bookmark.enrichmentMeta {sentiment, people[], companies[]}

  (c) CATEGORIZE  ── text ONLY ──→ text LLM
        lib/categorizer.ts: categorizeBatch  (batch of 25)
        sent:   tweet text (≤400 chars) + flattened image context + aiTags + hashtags + tools
        output: BookmarkCategory rows (with confidence)

STAGE 3 — lib/fts.ts rebuildFts() → FTS5 search index
```

The **only** coupling between the two tracks: the vision step's *output* (OCR text + tags) is flattened into text (`lib/image-context.ts: buildImageContext`) and fed into the enrichment + categorization text calls. No image bytes reach a text model; no tweet text reaches the vision model.

### The five LLM call sites

| Call site | File | Modality | max_tokens | Batch |
|-----------|------|----------|-----------|-------|
| Vision | `lib/vision-analyzer.ts` (`analyzeImageWithRetry`) | image | 700 | 1 image/req, 12 concurrent |
| Enrichment | `lib/vision-analyzer.ts` (`enrichBatchSemanticTags`) | text | 4096 | 1 tweet/req in pipeline (supports 5) |
| Categorize | `lib/categorizer.ts` (`categorizeBatch`) | text | 2048 | 25 tweets |
| AI search rerank | `app/api/search/ai/route.ts` | text | 1500 | ~150 candidates |
| Category suggest | `lib/category-suggester.ts` | text | 4000 | 100 samples |

### Shared patterns (and their gaps)

- **CLI-first / SDK-fallback dispatch** — try `claude`/`codex` subprocess, else SDK client. **Copy-pasted across 4 files** (~150 lines): `search/ai/route.ts`, `category-suggester.ts`, `categorizer.ts`, `vision-analyzer.ts` (×2). No shared helper.
- **No `system` role, no `temperature`, no streaming, no structured-output/tool-use.** Every prompt is a single `{role:'user'}` message with instructions inline.
- **`max_tokens` hardcoded per call site** (see table).
- **Confidence hard-clamped to [0.5, 1.0]** on parse (`categorizer.ts` `parseCategorizationResponse`) — the model cannot signal low confidence; default 0.8 if missing.
- **No token budgeting** — batching is pure count-based (25). The `tools` field in the categorization prompt is uncapped.
- **A malformed categorization response throws and the whole 25-tweet batch is skipped** (logged; retried next run because `enrichedAt` stays null).
- **`AIClient.provider` is only `'anthropic'|'openai'|'minimax'`** — the `custom` provider reuses `OpenAIAIClient` and misreports as `'openai'` (`lib/ai-client.ts:158-168`).
- **Known latent bug** (`lib/ai-client.ts:91`): `OpenAIAIClient` has a no-op `.map(p => p.type === 'text' ? p : p)` then filters out non-text blocks for assistant messages — silently drops images in assistant content. Not currently exercised (all prompts are single user messages).

### What the categorizer actually receives per bookmark (`lib/categorizer.ts: buildCategorizationPrompt`)

| field | sent | cap |
|-------|------|-----|
| `text` | tweet body | 400 chars |
| `images` | flattened vision JSON (Style\|Scene\|Action\|Text\|Visual tags\|Meme) | OCR 200 chars, tags 15 |
| `aiTags` | semantic tags | 20 |
| `hashtags` | | 10 |
| `tools` | detected tools | **uncapped** |

**Deliberately excluded from categorization:** author, date, raw URLs, mentions, tweetType — *and the `enrichmentMeta` (sentiment/people/companies) that the prior stage just computed and stored.* That enrichment data is currently wasted signal.

---

## Part 2 — Diagnosis: why DeepSeek-V4-Pro results are poor

### The model is text-only

Multiple sources confirm **DeepSeek-V4-Pro (and V4-Flash) are text-only MoE language models** — no native vision. Passing images is "silently ignored or cause[s] an error." A separate DeepSeek-VL2 vision variant exists, but V4-Pro itself cannot see images.

Sources:
- [MindStudio — DeepSeek V4 review](https://www.mindstudio.ai/blog/deepseek-v4-open-source-frontier-model-review)
- [TechCrunch — DeepSeek V4 preview](https://techcrunch.com/2026/04/24/deepseek-previews-new-ai-model-that-closes-the-gap-with-frontier-models/)
- [DeepSeek API docs](https://api-docs.deepseek.com/news/news260424)

### The failure mechanism

In the vision step, `OpenAIAIClient.createMessage` converts the image to an OpenAI `image_url` data URL and sends it with `ANALYSIS_PROMPT`. DeepSeek-V4-Pro **cannot process the image**, so it responds with a *text* error:

```json
{"error":"No image provided in request — image data is missing or not accessible. Please provide an image for analysis."}
```

That response is **valid JSON**, so Siftly's parser (`match(/\{[\s\S]*\}/)` + `JSON.parse`) accepts it and stores it verbatim as `MediaItem.imageTags`. The model is literally telling Siftly "I can't see images," and Siftly is storing that message as the analysis.

(Note: the `'{}'` failure sentinel only appears on a *hard* fetch/parse failure. Here the model "successfully" returned a JSON error object, so it gets stored as-is — which is why the failure was invisible.)

### DB evidence (queried 2026-07-11, `prisma/dev.db`)

```
Total MediaItems:                         354
Genuinely analyzed (no 'error' key):       29   ←  ~8%
Empty '{}' sentinel or error-stored:      325  ← ~92%
Bookmarks with media:                     292
```

Sample of the failure content actually stored as `imageTags`:
```json
{"error":"No image provided in request — image data is missing or not accessible. Please provide an image for analysis."}
```

**Conclusion:** the vision stage is effectively broken under DeepSeek-V4-Pro. The 292 image-bearing bookmarks get no image signal, so categorization runs on tweet text alone — poor for screenshot-heavy content (charts, memes, code, quote-screenshots).

---

## Part 3 — Improvement opportunities

### A. The proposed redesign: separate OCR/image pipeline (PRIMARY)

The user's idea — split image processing onto its own pipeline with a dedicated model — is correct and high-leverage. Two design points confirmed:

1. **Downstream plumbing already exists.** OCR text lands in `MediaItem.imageTags.text_ocr`, which is *already* fed to both the categorizer (`buildImageContext` in `lib/image-context.ts`) and the FTS5 search index (`rebuildFts` in `lib/fts.ts`). So a reliable OCR step improves categorization + search automatically, for free.
2. **The current vision step bundles 9 jobs into one call** (OCR + objects + scene + mood + style + meme-template + tags + people + chart-special-casing). OCR is deterministic/commodity; the rest is semantic interpretation better done by the text LLM once it has the OCR'd text.

This also fixes the root cause of Part 2: keep DeepSeek-V4-Pro for the **text** stages (its strength), and use a **multimodal or dedicated-OCR** model for the image stage.

### B. Other improvements surfaced during investigation

**Accuracy (prompts):**
- Feed the already-computed `enrichmentMeta` (sentiment/people/companies) into categorization — currently computed and discarded. Cheapest quality win.
- Add few-shot examples for the edge cases the prose rules struggle with (e.g. "news *about* AI is `news`, not `ai-resources`").
- Add a `system` prompt (separate instructions from data).
- Stop hard-clamping confidence at 0.5 — preserve the low-confidence signal for review.

**Cost & speed:**
- **Resize images before base64** — `sharp` is already installed (transitively). Would cut token cost *and* rescue images >3.5MB that are currently skipped entirely (`MAX_IMAGE_BYTES`).
- **Batch enrichment** — pipeline currently calls `enrichBatchSemanticTags` with a 1-element array (1 tweet/call) even though it supports batch size 5. ~5× fewer calls possible.
- Set **token budgets** instead of fixed counts for categorization batches.

**Robustness:**
- **Retry categorization batches on malformed JSON** — currently a bad response silently drops 25 tweets.
- Set **temperature** low (e.g. 0.2–0.3) for structured tasks.
- Detect & handle the "model returned an error JSON as content" case (Part 2) — store failed analyses distinctly from successes so the failure is visible, not silent.

**Code health:**
- Collapse the 4 duplicated CLI-first/SDK dispatch sites into one `runPrompt(prompt, {maxTokens, timeoutMs})` helper (~150 lines).
- Fix `custom` provider misreporting as `'openai'` (`AIClient.provider`).

---

## Part 4 — Open decisions (resolve before implementing)

1. **Image pipeline output — OCR-only vs OCR + semantic vision?**
   - *OCR-only:* cheapest, simplest; loses non-text signal (chart direction, meme template, objects). Text LLM infers semantics from OCR'd text.
   - *OCR + lightweight semantic vision pass:* preserves meme/chart/object signal; costs a second (multimodal) model call.
   - *OCR-first with semantic fallback:* run cheap OCR always; only call semantic vision when OCR yields little text (e.g. a photo/meme/chart). Elegant middle ground.

2. **Which OCR/multimodal engine for the image step?**
   - DeepSeek-VL2 (DeepSeek's actual vision model)
   - NVIDIA NIM free tier (multimodal models; user already set this up as a provider)
   - z.ai GLM-4.6 (confirmed multimodal — vision works)
   - Local OCR (Tesseract / PaddleOCR) — free, offline, self-hosted, fits Siftly's philosophy; text-only extraction
   - Reuse the main provider's model (only viable if it's multimodal — DeepSeek-V4-Pro is NOT)

3. **Separate provider/model config for the image step?**
   - Almost certainly yes — the whole point is a *different* model for images than for text. Would follow the same pattern as the `custom` provider added on this branch (`customBaseUrl`/`customApiKey`/`customModel` settings + UI block).

---

## File reference map

| Concern | File |
|---------|------|
| Pipeline orchestration | `app/api/categorize/route.ts` |
| Vision (image → imageTags) | `lib/vision-analyzer.ts` (`analyzeItem`, `analyzeImageWithRetry`, `ANALYSIS_PROMPT`) |
| Image context flattener | `lib/image-context.ts` (`buildImageContext`) |
| Enrichment (text → semanticTags) | `lib/vision-analyzer.ts` (`enrichBatchSemanticTags`, `buildEnrichmentPrompt`) |
| Categorization (text → categories) | `lib/categorizer.ts` (`categorizeBatch`, `buildCategorizationPrompt`, `parseCategorizationResponse`, `DEFAULT_CATEGORIES`) |
| LLM client abstraction | `lib/ai-client.ts` (`AIClient`, `resolveAIClient`, provider wrappers) |
| Provider/model resolution | `lib/settings.ts` (`getProvider`, `getActiveModel`, `providerToKeyName`) |
| Deterministic entity extraction | `lib/rawjson-extractor.ts` (`backfillEntities`, `KNOWN_TOOL_DOMAINS`) |
| FTS5 index | `lib/fts.ts` (`rebuildFts`, `ftsSearch`) |
| AI semantic search | `app/api/search/ai/route.ts` |
| Category suggestion | `lib/category-suggester.ts` |
| CLI subprocess wrappers | `lib/claude-cli.ts` (`claudePrompt`), `lib/codex-cli.ts` (`codexPrompt`) |
| Schema (Bookmark / MediaItem / imageTags) | `prisma/schema.prisma` |

---

## How to resume

- Re-confirm the diagnosis is still valid: `sqlite3 prisma/dev.db "SELECT COUNT(*) FROM MediaItem WHERE imageTags LIKE '%error%' OR imageTags = '{}';"`
- Resolve the 3 open decisions in Part 4.
- Likely first concrete step: add a separately-configured image/OCR model, swap `analyzeItem`'s model to it (or to a dedicated OCR call), and re-run the categorize pipeline with `force` to re-analyze the 325 failed images.
