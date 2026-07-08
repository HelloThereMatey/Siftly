import OpenAI from 'openai'

/**
 * Resolve a Custom OpenAI-compatible client.
 *
 * Exposes an OpenAI-compatible API at a configurable base URL.
 * Auth priority:
 *   1. Override key (from request body)
 *   2. DB-saved key
 *   3. CUSTOM_API_KEY env var
 *   4. Custom base URL (proxy mode)
 */
export function resolveCustomClient(options: {
  overrideKey?: string
  dbKey?: string
  baseURL?: string | null
} = {}): OpenAI {
  const baseURL = options.baseURL ?? process.env.CUSTOM_BASE_URL

  if (!baseURL) {
    throw new Error('No Custom API base URL found. Add your base URL in Settings, or set CUSTOM_BASE_URL.')
  }

  if (options.overrideKey?.trim()) {
    return new OpenAI({ apiKey: options.overrideKey.trim(), baseURL })
  }

  if (options.dbKey?.trim()) {
    return new OpenAI({ apiKey: options.dbKey.trim(), baseURL })
  }

  const envKey = process.env.CUSTOM_API_KEY?.trim()
  if (envKey) return new OpenAI({ apiKey: envKey, baseURL })

  // Proxy mode — assume proxy handles auth
  return new OpenAI({ apiKey: 'proxy', baseURL })
}
