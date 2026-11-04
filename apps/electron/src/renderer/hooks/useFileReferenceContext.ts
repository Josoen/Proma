import { useEffect, useState } from 'react'
import { useAtomValue, useStore } from 'jotai'
import {
  agentAttachedDirectoriesMapAtom,
  agentAttachedFilesMapAtom,
  agentFileReferenceChangesAtom,
  agentFileReferenceContextAtomFamily,
  agentSessionPathMapAtom,
  agentSessionsAtom,
  agentWorkspacesAtom,
  currentAgentSessionIdAtom,
  workspaceAttachedDirectoriesMapAtom,
  workspaceAttachedFilesMapAtom,
} from '@/atoms/agent-atoms'
import { doesFileChangeAffectReference } from '@/lib/file-reference-resolution'
import { detectIsWindows } from '@/lib/platform'

/** 全局通知只唤醒受影响的引用；文件变化不会使其他会话的解析结果失效。 */
export function useFileReferenceContext(sessionId: string | undefined, candidateBases: string[], resolvedPath?: string, watchChanges = true) {
  const store = useStore()
  const activeSessionId = useAtomValue(currentAgentSessionIdAtom)
  const resolvedSessionId = sessionId ?? activeSessionId ?? undefined
  const authorization = useAtomValue(agentFileReferenceContextAtomFamily(resolvedSessionId))
  const [changeVersion, setChangeVersion] = useState(0)

  useEffect(() => {
    if (!watchChanges || !resolvedSessionId) return
    return store.sub(agentFileReferenceChangesAtom, () => {
      const change = store.get(agentFileReferenceChangesAtom)
      if (resolvedPath) {
        if (doesFileChangeAffectReference(change.paths, { resolvedPath, directoryRoots: [], attachedFiles: [] }, detectIsWindows())) {
          setChangeVersion(change.version)
        }
        return
      }
      const session = store.get(agentSessionsAtom).find((item) => item.id === resolvedSessionId)
      const workspaceId = session?.workspaceId ?? ''
      const workspace = store.get(agentWorkspacesAtom).find((item) => item.id === workspaceId)
      const directories = [
        ...candidateBases,
        store.get(agentSessionPathMapAtom).get(resolvedSessionId),
        session?.activeWorktree?.path,
        workspace?.projectRootPath,
        ...(session?.attachedDirectories ?? []),
        ...(store.get(agentAttachedDirectoriesMapAtom).get(resolvedSessionId) ?? []),
        ...(store.get(workspaceAttachedDirectoriesMapAtom).get(workspaceId) ?? []),
      ].filter((path): path is string => Boolean(path))
      const files = [
        ...(session?.attachedFiles ?? []),
        ...(store.get(agentAttachedFilesMapAtom).get(resolvedSessionId) ?? []),
        ...(store.get(workspaceAttachedFilesMapAtom).get(workspaceId) ?? []),
      ]
      if (doesFileChangeAffectReference(change.paths, { directoryRoots: directories, attachedFiles: files }, detectIsWindows())) {
        setChangeVersion(change.version)
      }
    })
  }, [store, resolvedSessionId, candidateBases, resolvedPath, watchChanges])

  return { resolvedSessionId, authorization, revision: `${authorization}\0${changeVersion}` }
}
