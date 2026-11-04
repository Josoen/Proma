export interface FileResolutionEntry {
  exists: boolean
  resolvedPath?: string
}

export interface FileReferenceChangeScope {
  resolvedPath?: string
  directoryRoots: readonly string[]
  attachedFiles: readonly string[]
}

/** 只筛选通知的影响范围；实际路径解析与授权仍由主进程完成。 */
export function doesFileChangeAffectReference(changedPaths: readonly string[], scope: FileReferenceChangeScope, isWindows: boolean): boolean {
  const normalize = (path: string): string => {
    const nativePath = isWindows ? path.replace(/\\/g, '/').toLowerCase() : path
    return nativePath.replace(/\/+$/, '')
  }
  const isWithin = (target: string, root: string): boolean => target === root || target.startsWith(`${root}/`)
  return changedPaths.some((path) => {
    const changed = normalize(path)
    // 已知实际文件只响应自身或父目录的变化（包含目录删除/重建）。
    if (scope.resolvedPath) return isWithin(normalize(scope.resolvedPath), changed)
    return scope.directoryRoots.some((root) => {
      const normalizedRoot = normalize(root)
      return isWithin(changed, normalizedRoot) || isWithin(normalizedRoot, changed)
    }) || scope.attachedFiles.some((file) => isWithin(normalize(file), changed))
  })
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
