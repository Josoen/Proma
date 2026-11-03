import { expect, test } from 'bun:test'
import { clearSidebarSessionDrag, getSidebarSessionDrag, readSidebarSessionDrop, setSidebarSessionDrag } from './sidebar-session-drag'
import { getSessionReferenceDragData, setSessionReferenceDragData } from './session-reference-drag'

test('Given 会话引用拖拽 When 附加长按全局资格 Then copy/move 共存且取消清理状态', () => {
  const data = new Map<string, string>()
  const transfer = {
    get types() { return [...data.keys()] },
    effectAllowed: 'copy',
    setData: (key: string, value: string) => data.set(key, value),
    getData: (key: string) => data.get(key) ?? '',
  } as unknown as DataTransfer
  setSessionReferenceDragData(transfer, { sessionId: 'a', title: '原引用' })
  expect(getSidebarSessionDrag(transfer)).toBeNull()
  setSidebarSessionDrag(transfer, { sessionId: 'a', workspaceId: 'project' })
  expect(transfer.effectAllowed).toBe('copyMove')
  expect(getSessionReferenceDragData(transfer)?.sessionId).toBe('a')
  expect(readSidebarSessionDrop(transfer)).toEqual({ sessionId: 'a', workspaceId: 'project' })
  clearSidebarSessionDrag()
  expect(getSidebarSessionDrag(transfer)).toBeNull()
})
