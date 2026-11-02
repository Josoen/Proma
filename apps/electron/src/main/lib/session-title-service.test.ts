import { describe, expect, mock, test } from 'bun:test'
import type { Channel, ProviderType } from '@proma/shared'
import { getSessionTitleModelError, validateSessionTitleSettings } from '../../types/session-title'
import { generateSessionTitle } from './session-title-service'
import type { SessionTitleDependencies } from './session-title-service'
import { TITLE_PROMPT } from './title-generation'

function channel(id: string, provider: ProviderType = 'custom', modelId = 'title-model'): Channel {
  return {
    id, name: id, provider, baseUrl: 'https://example.invalid/v1', apiKey: 'encrypted', enabled: true,
    models: [{ id: modelId, name: modelId, enabled: true }], createdAt: 0, updatedAt: 0,
  }
}

const input = { userMessage: '# 修复启动问题\n第二行', channelId: 'session', modelId: 'title-model' }

describe('Agent 标题配置', () => {
  test('Given no independent model When validating Then follows the session without configurable Prompt or thinking', () => {
    expect(validateSessionTitleSettings({})).toEqual({})
    expect(validateSessionTitleSettings({ promptTemplate: 'ignored', thinkingLevel: 'high' })).toEqual({})
    expect(validateSessionTitleSettings({ model: { channelId: ' a ', modelId: ' b ' } })).toEqual({ model: { channelId: 'a', modelId: 'b' } })
  })

  test('Given partial or malformed references When validating Then rejects instead of silently following the session', () => {
    for (const value of [null, [], '', { model: null }, { model: {} }, { model: { channelId: 'x' } }, { model: { channelId: 'x', modelId: ' ' } }]) {
      expect(() => validateSessionTitleSettings(value)).toThrow()
    }
  })

  test('Given models with known mandatory reasoning When selecting Then refuses off even if a user override claims support', () => {
    for (const [provider, id] of [['openai-responses', 'gpt-6-astra'], ['google', 'gemini-3.1-pro']] as const) {
      const configured = channel('x', provider, id)
      configured.models[0]!.thinkingLevels = ['off', 'high']
      expect(getSessionTitleModelError(configured, id)).toContain('不支持关闭思考')
    }
    expect(getSessionTitleModelError(channel('x', 'openai-responses', 'gpt-6-sol'), 'gpt-6-sol')).toBeNull()
  })
})

describe('Agent 标题生成', () => {
  test('Given no title settings When generating Then follows this session and uses the fixed Prompt', async () => {
    const selected = channel('session')
    const complete = mock<SessionTitleDependencies['complete']>(async () => '“启动修复”')
    expect(await generateSessionTitle(input, undefined, { getChannel: () => selected, complete })).toBe('启动修复')
    expect(complete).toHaveBeenCalledWith(selected, input.modelId, TITLE_PROMPT + input.userMessage, undefined)
  })

  test('Given an independent API model and OAuth session When generating Then only uses the selected title route', async () => {
    const selected = channel('independent', 'openai', 'gpt-6-sol')
    const getChannel = mock((id: string) => id === selected.id ? selected : channel('session', 'openai-codex'))
    const complete = mock<SessionTitleDependencies['complete']>(async () => '标题')
    expect(await generateSessionTitle(input, { model: { channelId: selected.id, modelId: 'gpt-6-sol' } }, { getChannel, complete })).toBe('标题')
    expect(getChannel).toHaveBeenCalledTimes(1)
    expect(getChannel).toHaveBeenCalledWith('independent')
    expect(complete.mock.calls[0]).toEqual([selected, 'gpt-6-sol', TITLE_PROMPT + input.userMessage, undefined])
    expect(input.channelId).toBe('session')
  })

  test('Given a long first message When generating Then sends at most 4000 input characters and caps the title', async () => {
    const complete = mock<SessionTitleDependencies['complete']>(async () => '标'.repeat(30))
    const title = await generateSessionTitle({ ...input, userMessage: '文'.repeat(5_000) }, {}, { getChannel: () => channel('session'), complete })
    expect(complete.mock.calls[0]?.[2]).toBe(TITLE_PROMPT + '文'.repeat(4_000))
    expect(title).toHaveLength(20)
  })

  test('Given removed or disabled explicit models When generating Then makes no remote call and never switches providers', async () => {
    const disabled = { ...channel('independent'), enabled: false }
    for (const selected of [undefined, disabled, { ...channel('independent'), models: [] }]) {
      const getChannel = mock(() => selected)
      const complete = mock(async () => '不应调用')
      expect(await generateSessionTitle(input, { model: { channelId: 'independent', modelId: 'title-model' } }, { getChannel, complete })).toBe('修复启动问题')
      expect(getChannel).toHaveBeenCalledWith('independent')
      expect(complete).not.toHaveBeenCalled()
    }
  })

  test('Given a malformed persisted reference When generating Then falls back locally without using the session route', async () => {
    const getChannel = mock(() => channel('session'))
    const complete = mock(async () => '不应调用')
    expect(await generateSessionTitle(input, { model: { channelId: '', modelId: '' } }, { getChannel, complete })).toBe('修复启动问题')
    expect(getChannel).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  test('Given empty output or request errors from any provider When generating Then returns a local title without retry', async () => {
    for (const provider of ['anthropic', 'openai', 'google', 'custom', 'openai-codex', 'github-copilot', 'xai'] as const) {
      for (const fails of [false, true]) {
        const complete = mock(async () => { if (fails) throw new Error('429'); return null })
        expect(await generateSessionTitle(input, {}, { getChannel: () => channel('session', provider), complete })).toBe('修复启动问题')
        expect(complete).toHaveBeenCalledTimes(1)
      }
    }
  })

  test('Given an aborted request or blank message When generating Then neither calls the model nor produces a fallback', async () => {
    const complete = mock(async () => '不应调用')
    const dependencies = { getChannel: () => channel('session'), complete }
    expect(await generateSessionTitle(input, {}, dependencies, AbortSignal.abort())).toBeNull()
    expect(await generateSessionTitle({ ...input, userMessage: ' \n ' }, {}, dependencies)).toBeNull()
    expect(complete).not.toHaveBeenCalled()
  })

  test('Given cancellation during a model request When it resolves or throws Then does not produce a fallback', async () => {
    for (const fails of [false, true]) {
      const controller = new AbortController()
      const complete = async () => { controller.abort(); if (fails) throw new Error('aborted'); return '迟到的标题' }
      expect(await generateSessionTitle(input, {}, { getChannel: () => channel('session'), complete }, controller.signal)).toBeNull()
    }
  })
})
