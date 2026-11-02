import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

describe('Agent 会话重新生成标题菜单契约', () => {
  test('Given Agent session rows When opening shared menus Then exposes regeneration with loading and error feedback', () => {
    const source = readFileSync(new URL('./LeftSidebar.tsx', import.meta.url), 'utf8')
    const agent = source.slice(source.indexOf('const AgentSessionItem ='))
    expect(agent).toContain("'重新生成标题'")
    expect(agent).toContain('disabled={titleRegenerating}')
    expect(agent).toContain('window.electronAPI.regenerateAgentSessionTitle(session.id)')
    expect(agent).toContain('toast.error(')
    expect(agent).toContain("toast.loading('正在重新生成标题…')")
    expect(agent).toContain('replaceAgentSessionInFreshnessOrder(previous, updated)')
    expect(agent).toContain('updateTabTitle(previous, session.id, updated.title)')
    expect(agent).toContain('menuItems(ContextMenuItem, ContextMenuSeparator)')
  })

  test('Given the renderer bridge When regenerating Then invokes the registered typed main-process handler', () => {
    const preload = readFileSync(new URL('../../../preload/index.ts', import.meta.url), 'utf8')
    const ipc = readFileSync(new URL('../../../main/ipc.ts', import.meta.url), 'utf8')
    expect(preload).toContain('regenerateAgentSessionTitle: (sessionId: string) => Promise<AgentSessionMeta>')
    expect(preload).toContain('ipcRenderer.invoke(AGENT_IPC_CHANNELS.REGENERATE_TITLE, sessionId)')
    expect(ipc).toContain('AGENT_IPC_CHANNELS.REGENERATE_TITLE,')
    expect(ipc).toContain('return regenerateAgentSessionTitle(sessionId)')
  })
})
