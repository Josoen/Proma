import { describe, expect, test } from 'bun:test'
import { applyAgentEvent } from './agent-atoms'
import type { AgentStreamState } from './agent-atoms'

function streamState(overrides: Partial<AgentStreamState> = {}): AgentStreamState {
  return { running: true, inputTokens: 100, ...overrides }
}

describe('上下文窗口显示优先级', () => {
  test('Given 已有 1M When 运行时上报 200K Then 直接调低', () => {
    const next = applyAgentEvent(streamState({ contextWindow: 1_000_000 }), {
      type: 'usage_update',
      usage: { contextWindow: 200_000, contextWindowSource: 'runtime' },
    })
    expect(next.contextWindow).toBe(200_000)
  })

  test('Given 已有 200K When 推断值上报 1M Then 保持权威值', () => {
    const next = applyAgentEvent(streamState({ contextWindow: 200_000 }), {
      type: 'usage_update',
      usage: { contextWindow: 1_000_000, contextWindowSource: 'inferred' },
    })
    expect(next.contextWindow).toBe(200_000)
  })

  test('Given 窗口为空 When 推断值上报 1M Then 填充兜底', () => {
    const next = applyAgentEvent(streamState(), {
      type: 'usage_update',
      usage: { contextWindow: 1_000_000, contextWindowSource: 'inferred' },
    })
    expect(next.contextWindow).toBe(1_000_000)
  })

  test('Given 已有 1M When complete 上报运行时 200K Then 直接覆盖', () => {
    const next = applyAgentEvent(streamState({ contextWindow: 1_000_000 }), {
      type: 'complete',
      stopReason: 'end_turn',
      usage: { contextWindow: 200_000, contextWindowSource: 'runtime' },
    })
    expect(next.contextWindow).toBe(200_000)
  })

  test('Given 已有窗口 When 仅更新 token Then 不清空窗口', () => {
    const next = applyAgentEvent(streamState({ contextWindow: 200_000 }), {
      type: 'usage_update',
      usage: { inputTokens: 1234 },
    })
    expect(next.contextWindow).toBe(200_000)
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'Given 非法窗口 %p When 更新 Then 保持原值',
    (contextWindow) => {
      const next = applyAgentEvent(streamState({ contextWindow: 200_000 }), {
        type: 'usage_update',
        usage: { contextWindow, contextWindowSource: 'runtime' },
      })
      expect(next.contextWindow).toBe(200_000)
    },
  )
})
