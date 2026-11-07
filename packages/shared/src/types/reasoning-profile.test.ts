import { describe, expect, test } from 'bun:test'
import { sortThinkingLevels } from './reasoning-profile'

describe('sortThinkingLevels', () => {
  test('Given 乱序的思考等级 When 排序 Then 按关闭到最大排列', () => {
    expect(sortThinkingLevels(['max', 'off', 'high', 'low', 'xhigh', 'medium']))
      .toEqual(['off', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  test('Given 用户只启用部分档位 When 排序 Then 仅保留启用档位且顺序正确', () => {
    expect(sortThinkingLevels(['max', 'off', 'high'])).toEqual(['off', 'high', 'max'])
  })

  test('Given 重复档位 When 排序 Then 去重', () => {
    expect(sortThinkingLevels(['high', 'high', 'low'])).toEqual(['low', 'high'])
  })
})
