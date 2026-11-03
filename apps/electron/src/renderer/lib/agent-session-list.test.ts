import { describe, expect, test } from 'bun:test'
import type { AgentSessionMeta } from '@proma/shared'
import { partitionSidebarSessions } from './agent-session-list'

function session(id: string, extra: Partial<AgentSessionMeta> = {}): AgentSessionMeta {
  return { id, title: id, workspaceId: 'a', createdAt: 1, updatedAt: 1, ...extra }
}

describe('双层置顶分区', () => {
  test('Given 旧 pinned When 分区 Then 留在项目不自动进入全局', () => {
    const result = partitionSidebarSessions([session('old', { pinned: true })], new Set())
    expect(result.global).toHaveLength(0)
    expect(result.project.map((item) => item.id)).toEqual(['old'])
  })
  test('Given 全局母会话和独立全局子会话 When 分区 Then 每条只有一个展示归属', () => {
    const result = partitionSidebarSessions([
      session('parent', { pinned: true, globalPinned: true }),
      session('child', { parentSessionId: 'parent', sourceDelegationId: 'd' }),
      session('independent', { parentSessionId: 'parent', sourceDelegationId: 'd', pinned: true, globalPinned: true }),
      session('hidden', { workspaceId: 'archived' }),
      session('draft', { isDraft: true }),
    ], new Set(['archived']))
    expect(result.global.map((item) => item.id)).toEqual(['parent', 'child', 'independent'])
    expect(result.project).toHaveLength(0)
  })
})
