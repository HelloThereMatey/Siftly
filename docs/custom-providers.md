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
   brew install routatic-proxy
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

---

## Quick Tips

- **Test button:** Each provider has a Test button in Settings that makes a tiny call to validate your key/base URL/model — use it before running a full categorize.
- **CLI vs SDK:** Siftly tries the CLI first (Claude for Anthropic, Codex for OpenAI) then falls back to the SDK client. Custom providers have no CLI, so they go straight to SDK.
- **Vision support:** Image analysis requires a multimodal model. z.ai GLM-4.6 supports vision; NIM Llama models do not. Choose your model accordingly.
