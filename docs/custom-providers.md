# Custom AI Providers

Siftly supports **custom OpenAI-compatible endpoints** via the "Custom" provider in Settings. This lets you use alternative LLMs like z.ai GLM or NVIDIA NIM directly, without a proxy.

---

## z.ai GLM Coding Plan

**Base URL:** `https://api.z.ai/api/coding/paas/v4`
**Model:** `glm-4.6`, `glm-4.5-air`, `glm-5`
**Key:** Get yours at [z.ai model API](https://docs.z.ai/guides/overview/quick-start) under the GLM Coding Plan (~$18/month)

### Setup

1. In Siftly Settings → **Custom** → paste:
   - **Base URL:** `https://api.z.ai/api/coding/paas/v4`
   - **API Key:** your z.ai API key
   - **Model:** `glm-4.6`
2. Click **Test** to verify.
3. Run categorize/vision/search → requests hit z.ai directly.

### Notes

- z.ai's coding endpoint is **OpenAI-compatible** (`/chat/completions`) and **multimodal** — vision works with GLM-4.6.
- The same endpoint also accepts Anthropic format (used by Claude Code), but Siftly's Custom provider uses the OpenAI SDK.

---

## NVIDIA NIM (free)

**Base URL:** `https://integrate.api.nvidia.com/v1`
**Models:** `meta/llama-3.3-70b-instruct`, `nvidia/llama-3.1-nemotron-70b-instruct`, `deepseek-ai/deepseek-r1`, and 80+ more free models
**Key:** Get a free key at [build.nvidia.com/models](https://build.nvidia.com/models) (click any model → "Get API key")

### Setup

1. In Siftly Settings → **Custom** → paste:
   - **Base URL:** `https://integrate.api.nvidia.com/v1`
   - **API Key:** `nvapi-...` (your NVIDIA key)
   - **Model:** `meta/llama-3.3-70b-instruct`
2. Click **Test**.
3. Run categorize → requests hit NVIDIA NIM.

### Notes

- **Free tier:** ~1,000 calls/month per model.
- **Vision:** Most NIM models are **text-only** and will fail image analysis. Use a multimodal model if you need vision (or switch to z.ai GLM-4.6).
- The endpoint is **OpenAI-compatible** — full [`/v1/chat/completions`](https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html) support.

---

## OpenCode Go (via routatic-proxy)

OpenCode Go ($5 first month → $10/month) provides curated coding models (GLM-5.2, Kimi K2.7, DeepSeek, etc.) through a local proxy that translates Anthropic-format requests to OpenCode's API. This requires **no Siftly code changes** — just point the Anthropic provider at the proxy.

### Setup

1. Install and configure routatic-proxy:
   ```bash
   brew tap routatic/tap && brew install routatic-proxy
   routatic-proxy init   # creates ~/.config/routatic-proxy/config.json
   # Edit config.json: add your OpenCode Go API key
   routatic-proxy serve
   ```
2. Set Siftly's **Anthropic** provider to route through the proxy by adding to your `.env`:
   ```bash
   ANTHROPIC_BASE_URL=http://127.0.0.1:3456
   ```
3. Restart Siftly.
4. Categorize/vision/search → requests flow through routatic-proxy → OpenCode Go.

### Notes

- routatic-proxy speaks **Anthropic format** on the front and translates to OpenCode on the backend — Siftly's Anthropic SDK just sees Anthropic.
- The proxy does **automatic model selection**, so Siftly's model setting is ignored (choose the right model in routatic's config instead).
- The Claude CLI binary (if installed) also respects `ANTHROPIC_BASE_URL`, so both SDK and CLI paths route through the proxy.
- **No Siftly UI changes needed** — this works today. Just configure the env and restart.

### Troubleshooting

- If the proxy isn't running or the base URL is wrong, Siftly will fail to reach the Anthropic endpoint — verify with `curl http://127.0.0.1:3456` or the proxy logs.
- Check that OpenCode Go credentials are valid in `~/.config/routatic-proxy/config.json` — the proxy needs them to connect.
- See [routatic/proxy](https://github.com/routatic/proxy) for full config options and troubleshooting.

### Routing vision to a different model than text

Siftly sends the **same** model name (your configured Anthropic model) for every AI call — vision, enrichment, categorization, and search. routatic-proxy can still split these: it auto-detects requests that contain an image and routes them to a dedicated **vision** scenario, leaving text on the `default` scenario. So you can run a multimodal model for images (e.g. `minimax-m3`) and a strong text model for everything else (e.g. `deepseek-v4-pro`). No Siftly code changes are needed — the image request Siftly already sends (a non-streaming Anthropic message with a `{type:"image", source:{base64}}` block) is exactly what the proxy's vision path expects.

**1. Configure all three vision scenarios.** The proxy distinguishes `vision`, `vision_complex` (image + reasoning keywords), and `vision_long_context` (image + high token count). Siftly's `ANALYSIS_PROMPT` starts with *"Analyze…"* — and `analyze` is a reasoning keyword — so image requests classify as **`vision_complex`**, not `vision`. Configure all three, or image requests error with `vision scenario vision_complex is not configured`:

```json
"models": {
  "default":              { "provider": "opencode-go", "model_id": "deepseek-v4-pro", "max_tokens": 8192 },
  "vision":               { "provider": "opencode-go", "model_id": "minimax-m3", "vision": true, "temperature": 0.3, "max_tokens": 2048 },
  "vision_complex":       { "provider": "opencode-go", "model_id": "minimax-m3", "vision": true, "temperature": 0.3, "max_tokens": 2048 },
  "vision_long_context":  { "provider": "opencode-go", "model_id": "minimax-m3", "vision": true, "temperature": 0.3, "max_tokens": 4096, "context_threshold": 80000 }
},
"fallbacks": {
  "vision":               [{ "provider": "opencode-go", "model_id": "qwen3.7-max" }, { "provider": "opencode-go", "model_id": "kimi-k2.7-code" }],
  "vision_complex":       [{ "provider": "opencode-go", "model_id": "qwen3.7-max" }, { "provider": "opencode-go", "model_id": "kimi-k2.7-code" }],
  "vision_long_context":  [{ "provider": "opencode-go", "model_id": "qwen3.7-max" }, { "provider": "opencode-go", "model_id": "kimi-k2.7-code" }]
}
```

**2. Force `vision: true` if the proxy under-detects your model.** The proxy ships a built-in capability registry, and it marks some genuinely-multimodal models as non-vision — **`minimax-m3` is `Vision: false` in the registry** even though it natively accepts images. Without `"vision": true"`, the capacity filter skips it for image requests (log line: `model skipped by capacity filter ... reason=vision_not_supported`). An explicit `vision: true` overrides the registry. If your chosen model truly can't accept images, the proxy will still route to it but the upstream will error — pick a registry-confirmed multimodal model (`qwen3.7-max`, `kimi-k2.7-code`, `mimo-v2-omni`) instead.

**3. Put the OpenCode key in the provider blocks, not the top level.** The proxy reads upstream credentials **only** from `opencode_go.api_key` / `opencode_zen.api_key` — the top-level `api_key` is used for startup validation and inbound client auth, not for talking to OpenCode. An empty provider key produces `API error 401: AuthError "Invalid API key"` on **every** request (vision and text). Also, `"${VAR}"` is env-var interpolation, so a literal key must **not** be wrapped in `${}` (that resolves to empty):

```json
"opencode_go":  { "base_url": "https://opencode.ai/zen/go/v1/chat/completions", "api_key": "sk-...", "timeout_ms": 300000 },
"opencode_zen": { "base_url": "https://opencode.ai/zen/v1/chat/completions",    "api_key": "sk-...", "timeout_ms": 300000 }
```

**4. Don't let a `model_overrides` entry hijack Siftly's traffic.** Overrides take precedence over scenario routing. If your Siftly Anthropic model name (e.g. `claude-opus-4-6`) appears as a `model_overrides` key, **all** of Siftly's requests — vision and text — get pinned to that one chain and the vision/text split is bypassed (log shows `scenario=override` instead of `scenario=vision_complex`). Remove that override entry, or set Siftly's model to a name that isn't overridden, so requests fall through to scenario routing. (Keep `respect_requested_model: false` so the requested name is used only for override matching, not as the upstream model.)

**Verify.** After restarting the proxy (`systemctl restart routatic-proxy`, or `routatic-proxy serve`), tail the logs while running a categorize and confirm image requests route to your vision model:

```bash
journalctl -u routatic-proxy -f | grep -E 'routing request|attempting model'
# expect: scenario=vision_complex model=minimax-m3 ... attempting model model=minimax-m3 attempt=1
```

If vision had previously run against a text-only model, the failed analyses are cached — clear them and re-run with `force` (see [llm-pipeline-investigation.md](llm-pipeline-investigation.md) for the full diagnosis):

```bash
sqlite3 prisma/dev.db "UPDATE MediaItem SET imageTags = NULL WHERE type IN ('photo','gif','video') AND (imageTags = '{}' OR imageTags LIKE '%error%');"
curl -sX POST http://localhost:3000/api/categorize -H 'Content-Type: application/json' -d '{"force":true}'
```

---

## Quick Tips

- **Test button:** Each provider has a Test button in Settings that makes a tiny call to validate your key/base URL/model — use it before running a full categorize.
- **CLI vs SDK:** Siftly tries the CLI first (Claude for Anthropic, Codex for OpenAI) then falls back to the SDK client. Custom providers have no CLI, so they go straight to SDK.
- **Vision support:** Image analysis requires a multimodal model. z.ai GLM-4.6 supports vision; NIM Llama models do not. Choose your model accordingly.
