import { describe, expect, test } from 'bun:test'
import {
  CODEX_GPT_54_55_CONTEXT_WINDOW,
  DEFAULT_CONTEXT_WINDOW,
  ONE_MILLION_CONTEXT_WINDOW,
  resolveReportedContextWindow,
} from './context-window'

describe('运行时上下文窗口解析', () => {
  test('Given 用户把 1M 模型调低到 128K When 解析 Then 保留用户值不上调', () => {
    expect(resolveReportedContextWindow(131_072, 'deepseek-flash')).toBe(131_072)
  })

  test('Given 运行时上报大于推断值 When 解析 Then 保留上报值不下调', () => {
    expect(resolveReportedContextWindow(ONE_MILLION_CONTEXT_WINDOW, 'unknown-model')).toBe(ONE_MILLION_CONTEXT_WINDOW)
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined])(
    'Given 上报值 %p When 解析 Then 回退到模型推断',
    (reported) => {
      expect(resolveReportedContextWindow(reported, 'deepseek-flash')).toBe(ONE_MILLION_CONTEXT_WINDOW)
    },
  )

  test('Given Codex 家族模型上报 0 When 解析 Then 使用 Codex 对齐窗口', () => {
    expect(resolveReportedContextWindow(0, 'gpt-5.4')).toBe(CODEX_GPT_54_55_CONTEXT_WINDOW)
  })

  test('Given 上报值与模型都缺失 When 解析 Then 使用默认窗口', () => {
    expect(resolveReportedContextWindow(undefined, undefined)).toBe(DEFAULT_CONTEXT_WINDOW)
  })
})
