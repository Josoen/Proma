import { describe, expect, mock, spyOn, test } from 'bun:test'
import type { Api, Model, ModelsSimpleStreamOptions } from '@earendil-works/pi-ai/compat'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai/compat'
import { applyTitleThinkingOff, assertTitleThinkingOff, completePiTitleRequest } from './pi-title-generator'
import type { PiTitleRuntime } from './pi-title-generator'
import { buildModel } from './pi-model-registry'

function model(api: Api = 'openai-responses', id = 'gpt-6-sol'): Model<Api> {
  return {
    api, id, name: id, provider: 'test', baseUrl: 'http://127.0.0.1:1/v1', reasoning: true,
    input: ['text'], contextWindow: 100_000, maxTokens: 1_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
}

describe('Pi 标题单次请求', () => {
  test('Given a complete response with reasoning When generating Then returns visible text and uses isolated non-reasoning options', async () => {
    let options: ModelsSimpleStreamOptions | undefined
    const completeSimple = mock<PiTitleRuntime['completeSimple']>(async (_model, context, input) => {
      options = input
      expect(context.messages).toHaveLength(1)
      expect(context.systemPrompt).toContain('待总结的数据')
      expect(context.tools).toBeUndefined()
      return { stopReason: 'stop', content: [{ type: 'thinking', thinking: '不能成为标题' }, { type: 'text', text: '启动修复' }] }
    })
    expect(await completePiTitleRequest({ completeSimple }, model(), '固定 Prompt')).toBe('启动修复')
    expect(options).toMatchObject({ maxTokens: 256, timeoutMs: 30_000, maxRetries: 0, toolChoice: 'none', transport: 'auto' })
    expect(options?.reasoning).toBeUndefined()
    expect(options?.sessionId).toMatch(/^[\da-f-]{36}$/i)
    expect(options?.signal).toBeInstanceOf(AbortSignal)
    expect(completeSimple).toHaveBeenCalledTimes(1)
  })

  test('Given mandatory reasoning models When requesting a title Then refuses instead of silently upgrading off', async () => {
    const completeSimple = mock<PiTitleRuntime['completeSimple']>(async () => ({ stopReason: 'stop', content: [] }))
    for (const selected of [model('openai-responses', 'gpt-6-astra'), { ...model(), thinkingLevelMap: { off: null } }, { ...model(), thinkingLevelMap: { off: 'low' } }]) {
      expect(() => assertTitleThinkingOff(selected)).toThrow('不支持关闭思考')
      await expect(completePiTitleRequest({ completeSimple }, selected, '标题')).rejects.toThrow()
    }
    expect(completeSimple).not.toHaveBeenCalled()
    expect(() => assertTitleThinkingOff({ ...model(), reasoning: false })).not.toThrow()
  })

  test('Given empty, interrupted, truncated or tool-only responses When extracting Then never uses reasoning or incomplete text', async () => {
    for (const stopReason of ['error', 'aborted', 'length', 'toolUse'] as const) {
      const runtime: PiTitleRuntime = { completeSimple: async () => ({ stopReason, content: [{ type: 'text', text: '未完成' }] }) }
      await expect(completePiTitleRequest(runtime, model(), '标题')).rejects.toThrow('未正常完成')
    }
    const runtime: PiTitleRuntime = { completeSimple: async () => ({ stopReason: 'stop', content: [{ type: 'thinking', thinking: '不应显示' }] }) }
    expect(await completePiTitleRequest(runtime, model(), '标题')).toBeNull()
  })

  test('Given an aborted signal When requesting Then skips completion', async () => {
    const completeSimple = mock<PiTitleRuntime['completeSimple']>(async () => ({ stopReason: 'stop', content: [] }))
    expect(await completePiTitleRequest({ completeSimple }, model(), '标题', AbortSignal.abort())).toBeNull()
    expect(completeSimple).not.toHaveBeenCalled()
  })

  test('Given Responses and DeepSeek payloads When applying off Then reuses explicit protocol mappings without foreground effort', () => {
    expect(applyTitleThinkingOff({ model: 'gpt-6-sol', reasoning: { effort: 'high', mode: 'foreground' } }, model())).toEqual({ model: 'gpt-6-sol', reasoning: { effort: 'none' } })
    expect(applyTitleThinkingOff({ model: 'deepseek-v4-flash', thinking: { type: 'enabled' }, output_config: { effort: 'max' } }, model('anthropic-messages', 'deepseek-v4-flash'))).toEqual({ model: 'deepseek-v4-flash', thinking: { type: 'disabled' } })
  })
})

describe('Pi 真实请求构造（在发送前截获，不调用供应商）', () => {
  test('Given API channels When building title models Then uses memory storage and strips legacy model suffixes', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    const create = spyOn(sdk.ModelRuntime, 'create')
    try {
      const built = await buildModel(sdk, {
        sessionId: 'title-test', provider: 'openai', apiKey: 'test-key', baseUrl: 'http://127.0.0.1:1/v1', model: 'gpt-6-sol[1m]',
      }, true)
      expect(built.model.id).toBe('gpt-6-sol')
      expect(create.mock.calls[0]?.[0]).toMatchObject({ allowModelNetwork: false, modelsPath: null })
      expect(create.mock.calls[0]?.[0]?.credentials).toBeInstanceOf(InMemoryCredentialStore)
    } finally { create.mockRestore() }
  })

  for (const [provider, id, expected] of [
    ['openai', 'gpt-6-sol', { reasoning_effort: 'none', max_completion_tokens: 256 }],
    ['openai-responses', 'gpt-6-sol', { reasoning: { effort: 'none' }, max_output_tokens: 256 }],
    ['anthropic-compatible', 'title-test-model', { thinking: { type: 'disabled' }, max_tokens: 256 }],
    ['deepseek', 'deepseek-v4-flash', { thinking: { type: 'disabled' }, max_tokens: 256 }],
    ['google', 'gemini-2.5-flash', { config: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 256 } }],
  ] as const) {
    test(`Given ${provider}/${id} When Pi constructs the actual request Then encodes off and the title budget`, async () => {
      const sdk = await import('@earendil-works/pi-coding-agent')
      const built = await buildModel(sdk, {
        sessionId: 'title-wire', provider, apiKey: 'test-key', baseUrl: 'http://127.0.0.1:1/v1', model: id,
        ...(provider === 'openai' && { modelConfig: { thinkingLevels: ['off'] } }),
      }, true)
      let payload: unknown
      const runtime: PiTitleRuntime = {
        completeSimple: (selected, context, options) => built.modelRuntime.completeSimple(selected, context, {
          ...options,
          onPayload: async (raw, requestModel) => {
            payload = await options.onPayload?.(raw, requestModel) ?? raw
            throw new Error('测试已截获请求，禁止联网')
          },
        }),
      }
      await expect(completePiTitleRequest(runtime, built.model, '生成标题')).rejects.toThrow()
      expect(payload).toMatchObject(expected)
    })
  }

  test('Given OAuth channels When building title models Then keeps complete scoped credentials and forbids global model overlays', async () => {
    const sdk = await import('@earendil-works/pi-coding-agent')
    for (const provider of ['openai-codex', 'github-copilot', 'xai'] as const) {
      const selected = { ...model(provider === 'openai-codex' ? 'openai-codex-responses' : 'openai-responses'), provider }
      const runtime = await sdk.ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false })
      const methods = [
        spyOn(runtime, 'getModels').mockReturnValue([selected]),
        spyOn(runtime, 'getModel').mockReturnValue(selected),
        spyOn(runtime, 'getAvailable').mockResolvedValue([selected]),
      ]
      const create = spyOn(sdk.ModelRuntime, 'create').mockResolvedValue(runtime)
      try {
        const credentials = { access: 'access-token', refresh: 'refresh-token', expires: Date.now() + 3_600_000 }
        await buildModel(sdk, {
          sessionId: 'oauth-title', channelId: 'oauth-title', provider, apiKey: '', model: selected.id,
          codexOAuthCredentials: credentials,
          githubCopilotOAuthCredentials: { ...credentials, availableModelIds: [selected.id] },
          xaiOAuthCredentials: credentials,
        }, true)
        const options = create.mock.calls[0]?.[0]
        expect(options).toMatchObject({ allowModelNetwork: false, modelsPath: null })
        expect(await options?.credentials?.read(provider)).toMatchObject({ type: 'oauth', ...credentials })
        expect(await options?.credentials?.read('other-channel')).toBeUndefined()
      } finally { create.mockRestore(); methods.forEach((method) => method.mockRestore()) }
    }
  })
})
