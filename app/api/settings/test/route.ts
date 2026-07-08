import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { resolveAnthropicClient, getCliAuthStatus } from '@/lib/claude-cli-auth'
import { resolveOpenAIClient } from '@/lib/openai-auth'
import { resolveMiniMaxClient } from '@/lib/minimax-auth'
import { resolveCustomClient } from '@/lib/custom-auth'

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { provider?: string } = {}
  try {
    const text = await request.text()
    if (text.trim()) body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const provider = body.provider ?? 'anthropic'

  if (provider === 'anthropic') {
    const setting = await prisma.setting.findUnique({ where: { key: 'anthropicApiKey' } })
    const dbKey = setting?.value?.trim()

    let client
    try {
      client = resolveAnthropicClient({ dbKey })
    } catch {
      const cliStatus = getCliAuthStatus()
      if (cliStatus.available && cliStatus.expired) {
        return NextResponse.json({ working: false, error: 'Claude CLI session expired — run `claude` to refresh' })
      }
      return NextResponse.json({ working: false, error: 'No API key found. Add one in Settings or log in with Claude CLI.' })
    }

    try {
      await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return NextResponse.json({ working: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const friendly = msg.includes('401') || msg.includes('invalid_api_key')
        ? 'Invalid API key'
        : msg.includes('403')
        ? 'Key does not have permission'
        : msg.slice(0, 120)
      return NextResponse.json({ working: false, error: friendly })
    }
  }

  if (provider === 'openai') {
    const setting = await prisma.setting.findUnique({ where: { key: 'openaiApiKey' } })
    const dbKey = setting?.value?.trim()

    let client
    try {
      client = resolveOpenAIClient({ dbKey })
    } catch {
      return NextResponse.json({ working: false, error: 'No OpenAI API key found. Add one in Settings or set up Codex CLI.' })
    }

    try {
      await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return NextResponse.json({ working: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const friendly = msg.includes('401') || msg.includes('invalid_api_key')
        ? 'Invalid API key'
        : msg.includes('403')
        ? 'Key does not have permission'
        : msg.slice(0, 120)
      return NextResponse.json({ working: false, error: friendly })
    }
  }

  if (provider === 'minimax') {
    const setting = await prisma.setting.findUnique({ where: { key: 'minimaxApiKey' } })
    const dbKey = setting?.value?.trim()

    let client
    try {
      client = resolveMiniMaxClient({ dbKey })
    } catch {
      return NextResponse.json({ working: false, error: 'No MiniMax API key found. Add one in Settings or set MINIMAX_API_KEY.' })
    }

    try {
      await client.chat.completions.create({
        model: 'MiniMax-M2.7',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return NextResponse.json({ working: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const friendly = msg.includes('401') || msg.includes('invalid_api_key')
        ? 'Invalid API key'
        : msg.includes('403')
        ? 'Key does not have permission'
        : msg.slice(0, 120)
      return NextResponse.json({ working: false, error: friendly })
    }
  }

  if (provider === 'custom') {
    const [customApiKeySetting, customBaseUrlSetting, customModelSetting] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'customApiKey' } }),
      prisma.setting.findUnique({ where: { key: 'customBaseUrl' } }),
      prisma.setting.findUnique({ where: { key: 'customModel' } }),
    ])
    const dbKey = customApiKeySetting?.value?.trim()
    const baseURL = customBaseUrlSetting?.value?.trim()
    const model = customModelSetting?.value?.trim() ?? 'gpt-4.1-mini'

    if (!baseURL) {
      return NextResponse.json({ working: false, error: 'No base URL found. Add your base URL in Settings.' })
    }

    let client
    try {
      client = resolveCustomClient({ dbKey, baseURL })
    } catch {
      return NextResponse.json({ working: false, error: 'No API key found. Add your key in Settings or set CUSTOM_API_KEY.' })
    }

    try {
      await client.chat.completions.create({
        model,
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      })
      return NextResponse.json({ working: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const friendly = msg.includes('401') || msg.includes('invalid_api_key')
        ? 'Invalid API key'
        : msg.includes('403')
        ? 'Key does not have permission'
        : msg.slice(0, 120)
      return NextResponse.json({ working: false, error: friendly })
    }
  }

  return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
}
