export interface FileResolutionEntry {
  exists: boolean
  resolvedPath?: string
}

/** 只合并进行中的请求；完成结果不缓存，避免文件和授权变化后复用旧结论。 */
const requests = new Map<string, Promise<FileResolutionEntry>>()

export function fileReferenceKey(filePath: string, bases: string[], sessionId: string | undefined, revision: string): string {
  return JSON.stringify([sessionId, filePath, bases, revision])
}

export function resolveFileReference(filePath: string, bases: string[], sessionId: string | undefined, revision: string): Promise<FileResolutionEntry> {
  if (!sessionId) return Promise.resolve({ exists: false })
  const key = fileReferenceKey(filePath, bases, sessionId, revision)
  const inFlight = requests.get(key)
  if (inFlight) return inFlight

  const promise = window.electronAPI.resolveFilePath(filePath, {
    sessionId,
    candidateBasePaths: bases.length > 0 ? bases : undefined,
  }).then((resolved) => ({
    exists: Boolean(resolved?.resolvedPath),
    ...(resolved?.resolvedPath ? { resolvedPath: resolved.resolvedPath } : {}),
  })).finally(() => {
    requests.delete(key)
  })
  requests.set(key, promise)
  return promise
}
