export const SIDEBAR_SESSION_DRAG_MIME = 'application/x-proma-sidebar-session'
export const SIDEBAR_SESSION_HOLD_MS = 300

export interface SidebarSessionDrag {
  sessionId: string
  workspaceId: string
}

let activeDrag: SidebarSessionDrag | null = null

export function setSidebarSessionDrag(dataTransfer: DataTransfer, item: SidebarSessionDrag): void {
  activeDrag = item
  dataTransfer.setData(SIDEBAR_SESSION_DRAG_MIME, JSON.stringify(item))
  dataTransfer.effectAllowed = 'copyMove'
}

export function getSidebarSessionDrag(dataTransfer: DataTransfer): SidebarSessionDrag | null {
  return Array.from(dataTransfer.types).includes(SIDEBAR_SESSION_DRAG_MIME) ? activeDrag : null
}

export function clearSidebarSessionDrag(): void {
  activeDrag = null
}

export function readSidebarSessionDrop(dataTransfer: DataTransfer): SidebarSessionDrag | null {
  try {
    const item: unknown = JSON.parse(dataTransfer.getData(SIDEBAR_SESSION_DRAG_MIME))
    if (!item || typeof item !== 'object' || !('sessionId' in item) || !('workspaceId' in item)) return null
    if (typeof item.sessionId !== 'string' || !item.sessionId || typeof item.workspaceId !== 'string' || !item.workspaceId) return null
    return { sessionId: item.sessionId, workspaceId: item.workspaceId }
  } catch { return null }
}
