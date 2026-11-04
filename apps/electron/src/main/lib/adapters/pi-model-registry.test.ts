import { describe, expect, test } from 'bun:test'
import { buildModel } from './pi-model-registry'
import type { PiModelBuildInput } from './pi-model-registry'

const baseInput: PiModelBuildInput = {
  sessionId: 'context-window-test',
  provider: 'deepseek',
  apiKey: 'test-key',
  baseUrl: 'https://api.deepseek.com',
  channelName: 'test',
  model: 'deepseek-flash',
}

async function buildContextWindow(input: Partial<PiModelBuildInput>): Promise<number | undefined> {
  const sdk = await import('@earendil-works/pi-coding-agent')
  const built = await buildModel(sdk, { ...baseInput, ...input }, true)
  return built.model.contextWindow
}

describe('Pi 注册模型的上下文窗口', () => {
  test('Given 用户手动覆盖 128K When 注册 Then 使用用户值而不是家族推断值', async () => {
    expect(await buildContextWindow({
      modelConfig: { contextWindow: 131_072, contextWindowSource: 'user' },
    })).toBe(131_072)
  })

  test('Given 旧数据只带 contextWindow 未标 source When 注册 Then 仍按用户覆盖处理', async () => {
    expect(await buildContextWindow({
      modelConfig: { contextWindow: 131_072 },
    })).toBe(131_072)
  })

  test('Given 无用户覆盖的 1M 家族模型 When 注册 Then 使用家族推断窗口', async () => {
    expect(await buildContextWindow({})).toBe(1_000_000)
  })

  test('Given 无用户覆盖的未知模型 When 注册 Then 使用默认窗口', async () => {
    expect(await buildContextWindow({ model: 'totally-unknown-model-xyz' })).toBe(200_000)
  })
})
