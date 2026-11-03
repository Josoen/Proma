import type { AgentSessionMeta, AgentWorkspace } from '@proma/shared'

/** 查看历史不等于把已归档项目设为当前新建目标。 */
export function getActiveSessionProject(session: AgentSessionMeta | undefined, workspaces: readonly AgentWorkspace[]): string | undefined {
  return workspaces.find((workspace) => workspace.id === session?.workspaceId && !workspace.archived)?.id
}

export function getFallbackProject(workspaces: readonly AgentWorkspace[]): AgentWorkspace | undefined {
  return workspaces.find((workspace) => workspace.slug === 'default' && !workspace.archived) ?? workspaces.find((workspace) => !workspace.archived)
}
