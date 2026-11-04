import { describe, expect, test } from 'bun:test'
import { createStore } from 'jotai'
import {
  agentAttachedDirectoriesMapAtom,
  agentAttachedFilesMapAtom,
  agentFileReferenceContextAtomFamily,
  agentFileReferenceRevisionAtom,
  agentSessionsAtom,
  currentAgentSessionIdAtom,
  workspaceAttachedFilesMapAtom,
} from './agent-atoms'

describe('文件引用授权上下文', () => {
  test('given 嵌入子会话 when 切换活动会话或父会话授权 then 子会话解析上下文保持独立', () => {
    const store = createStore()
    const childContext = agentFileReferenceContextAtomFamily('child')
    const initial = store.get(childContext)
    store.set(currentAgentSessionIdAtom, 'parent')
    store.set(agentAttachedDirectoriesMapAtom, new Map([['parent', ['/parent']]]))
    expect(store.get(childContext)).toBe(initial)
    store.set(agentAttachedDirectoriesMapAtom, new Map([['child', ['/child']]]))
    expect(store.get(childContext)).not.toBe(initial)
  })

  test('given 同 key 引用 when 会话附件、工作区附件或文件通知变化 then 生成新上下文以触发重查', () => {
    const store = createStore()
    store.set(agentSessionsAtom, [{ id: 'child', title: '子会话', workspaceId: 'project', createdAt: 0, updatedAt: 0 }])
    const context = agentFileReferenceContextAtomFamily('child')
    let previous = store.get(context)
    store.set(agentAttachedFilesMapAtom, new Map([['child', ['/child/a.ts']]]))
    expect(store.get(context)).not.toBe(previous)
    previous = store.get(context)
    store.set(workspaceAttachedFilesMapAtom, new Map([['project', ['/project/a.ts']]]))
    expect(store.get(context)).not.toBe(previous)
    previous = store.get(context)
    store.set(agentFileReferenceRevisionAtom, (revision) => revision + 1)
    expect(store.get(context)).not.toBe(previous)
  })

})
