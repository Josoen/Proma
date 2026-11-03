import type { SetAgentWorkspaceArchivedInput, SetAgentWorkspaceArchivedResult } from '@proma/shared'
import { getAgentWorkspace, setAgentWorkspaceArchived } from './agent-workspace-manager'
import { archiveAgentSessionsInWorkspace, listAgentSessions } from './agent-session-manager'
import { isAgentSessionBusy } from './agent-service'
import { deferArchivedProjectAutomations } from './automation-manager'

/** 同步编排，检查与写入之间不让出事件循环；不使用删除墓碑。 */
export function setAgentProjectArchived(input: SetAgentWorkspaceArchivedInput): SetAgentWorkspaceArchivedResult {
  if (!input || typeof input.workspaceId !== 'string' || !input.workspaceId.trim() || typeof input.archived !== 'boolean') {
    throw new Error('项目归档参数无效')
  }
  const workspace = getAgentWorkspace(input.workspaceId)
  if (!workspace) throw new Error('项目不存在')
  if (input.archived && workspace.slug === 'default') throw new Error('默认项目不能归档')
  if (!input.archived) {
    if (workspace.archived) deferArchivedProjectAutomations(workspace.id)
    return { workspace: setAgentWorkspaceArchived(workspace.id, false), affectedSessionIds: [], status: 'success' }
  }
  const sessions = listAgentSessions().filter((session) => session.workspaceId === workspace.id)
  if (sessions.some((session) => isAgentSessionBusy(session.id))) {
    throw new Error('请先停止项目中的 Agent 并处理待发送消息')
  }
  const affectedSessionIds = archiveAgentSessionsInWorkspace(workspace.id)
  try {
    return { workspace: setAgentWorkspaceArchived(workspace.id, true), affectedSessionIds, status: 'success' }
  } catch {
    return { workspace, affectedSessionIds, status: 'partial', error: '会话已归档，项目归档失败，请重试' }
  }
}
