/**
 * FilePathChip — 文件路径可点击芯片
 *
 * 在 Agent 消息中检测到文件路径时，渲染为可点击的芯片。
 * 支持绝对路径和相对路径（相对于 basePath 解析）。
 * 点击后按用户偏好（标签页 / 侧边分屏）打开文件预览。
 */

import * as React from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { FileTypeIcon } from '@/components/file-browser/FileTypeIcon'
import { useOpenPreview } from '@/components/diff/preview-opener'
import { useFileReferenceContext } from '@/hooks/useFileReferenceContext'
import { fileReferenceKey, resolveFileReference } from '@/lib/file-reference-resolution'
import type { FileResolutionEntry } from '@/lib/file-reference-resolution'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  getFileName,
  getFilePathDisplayPath,
  isAbsoluteFilePath,
  isAsyncResultCurrent,
  isImageFilePath,
  isLocalFileReference,
  isRelativeFilePath,
  stripLineCol,
} from './file-path-chip-utils'

const inaccessibleFileMessage = '无法访问文件：可能不存在或不在当前会话授权范围内。'

interface FileReferenceSnapshot {
  /** 绑定路径、候选根、所属会话与授权上下文；文件变化由持有快照的父组件重查。 */
  key: string
  entry: FileResolutionEntry
}

interface FilePathChipProps {
  /** 文件路径（绝对或相对，可能带行号后缀） */
  filePath: string
  /** 基础目录路径（向后兼容，单值） */
  basePath?: string
  /** 多个候选基础目录（如主 cwd + 附加目录），点击时由主进程依次解析 */
  basePaths?: string[]
  /** 消息所属会话；嵌入子会话时不得回退为父会话的授权边界。 */
  sessionId?: string
  className?: string
  /** 正文候选刚取得的结果，供标签首次展示复用，交互仍重新检查。 */
  resolution?: FileReferenceSnapshot
}

/** 文件路径芯片 — 可点击，触发文件预览 */
export function FilePathChip({ filePath, basePath, basePaths, sessionId, className, resolution }: FilePathChipProps): React.ReactElement {
  const trimmedPath = filePath.trim()
  const { path: cleanPath, suffix: lineColSuffix } = stripLineCol(trimmedPath)
  const filename = getFileName(cleanPath)

  const chipRef = React.useRef<HTMLButtonElement>(null)
  const requestGenerationRef = React.useRef(0)
  const resolutionRequestRef = React.useRef<{ key: string; promise: Promise<FileResolutionEntry | null> } | null>(null)
  const mountedRef = React.useRef(true)
  const [fileStatus, setFileStatus] = React.useState<'idle' | 'resolved' | 'broken'>('idle')
  const [resolvedPath, setResolvedPath] = React.useState<string | undefined>()
  const openPreview = useOpenPreview()

  const candidateBases = React.useMemo<string[]>(() => {
    if (basePaths && basePaths.length > 0) return basePaths.filter(Boolean)
    if (basePath) return [basePath]
    return []
  }, [basePath, basePaths])
  const { resolvedSessionId, authorization, revision } = useFileReferenceContext(sessionId, candidateBases, resolvedPath, !resolution)
  const snapshotKey = fileReferenceKey(cleanPath, candidateBases, resolvedSessionId, authorization)

  const displayPath = React.useMemo(() => getFilePathDisplayPath({
    originalPath: trimmedPath,
    resolvedPath,
    lineColSuffix: resolvedPath ? lineColSuffix : '',
  }), [trimmedPath, resolvedPath, lineColSuffix])

  const resolutionKey = fileReferenceKey(cleanPath, candidateBases, resolvedSessionId, revision)
  const currentKeyRef = React.useRef(resolutionKey)
  currentKeyRef.current = resolutionKey
  const resolveCurrentPath = React.useCallback((): Promise<FileResolutionEntry | null> => {
    const inFlight = resolutionRequestRef.current
    if (inFlight?.key === resolutionKey) return inFlight.promise
    const generation = ++requestGenerationRef.current
    const promise = resolveFileReference(cleanPath, candidateBases, resolvedSessionId, revision).then((entry) => {
      if (!isAsyncResultCurrent(generation, requestGenerationRef.current, mountedRef.current) || currentKeyRef.current !== resolutionKey) return null
      setFileStatus(entry.exists ? 'resolved' : 'broken')
      setResolvedPath(entry.resolvedPath)
      return entry
    }).catch(() => {
      if (!isAsyncResultCurrent(generation, requestGenerationRef.current, mountedRef.current) || currentKeyRef.current !== resolutionKey) return null
      setFileStatus('broken')
      setResolvedPath(undefined)
      return { exists: false }
    }).finally(() => {
      if (resolutionRequestRef.current?.promise === promise) resolutionRequestRef.current = null
    })
    resolutionRequestRef.current = { key: resolutionKey, promise }
    return promise
  }, [cleanPath, candidateBases, resolvedSessionId, revision, resolutionKey])

  // 可见时解析；文件变化或授权上下文变化后重新检查，悬浮和点击也会获取最新结果。
  React.useEffect(() => {
    const el = chipRef.current
    requestGenerationRef.current += 1
    resolutionRequestRef.current = null
    mountedRef.current = true
    if (resolution?.key === snapshotKey) {
      setFileStatus(resolution.entry.exists ? 'resolved' : 'broken')
      setResolvedPath(resolution.entry.resolvedPath)
      return () => {
        mountedRef.current = false
        requestGenerationRef.current += 1
      }
    }
    setFileStatus('idle')
    setResolvedPath(undefined)
    if (!el || typeof IntersectionObserver === 'undefined') {
      void resolveCurrentPath()
      return () => {
        mountedRef.current = false
        requestGenerationRef.current += 1
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        observer.disconnect()
        void resolveCurrentPath()
      },
      { threshold: 0 },
    )
    observer.observe(el)
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
      observer.disconnect()
    }
  }, [resolveCurrentPath, resolution, snapshotKey])

  const handleTooltipOpenChange = React.useCallback((open: boolean) => {
    if (open) void resolveCurrentPath()
  }, [resolveCurrentPath])

  const handleClick = React.useCallback(async () => {
    if (!resolvedSessionId) return
    const entry = await resolveCurrentPath()
    if (!entry) return
    if (!entry.resolvedPath) {
      toast.error(inaccessibleFileMessage)
      return
    }
    openPreview(resolvedSessionId, {
      filePath: entry.resolvedPath,
      previewOnly: true,
      basePaths: candidateBases.length > 0 ? candidateBases : undefined,
    })
  }, [resolvedSessionId, resolveCurrentPath, openPreview, candidateBases])

  const handleShowInFolder = React.useCallback(async () => {
    const entry = await resolveCurrentPath()
    if (!entry) return
    if (!entry.resolvedPath) {
      toast.error(inaccessibleFileMessage)
      return
    }
    window.electronAPI.showItemInFolder(entry.resolvedPath)
      .then((ok) => { if (!ok) toast.error(inaccessibleFileMessage) })
      .catch(() => toast.error(inaccessibleFileMessage))
  }, [resolveCurrentPath])

  return (
    <ContextMenu>
      <Tooltip onOpenChange={handleTooltipOpenChange}>
        <ContextMenuTrigger asChild>
          <TooltipTrigger asChild>
            <button
              ref={chipRef}
              type="button"
              onClick={handleClick}
              className={cn(
                'inline-flex items-center gap-[0.25em] rounded px-[0.35em] py-[0.15em] text-[0.875em] font-medium leading-none',
                'cursor-pointer transition-colors duration-150',
                'align-baseline not-prose',
                fileStatus === 'broken'
                  ? 'opacity-50 border border-dashed border-muted-foreground/30 text-muted-foreground hover:opacity-70 hover:bg-muted/20'
                  : 'bg-primary/10 text-primary hover:bg-primary/20',
                className,
              )}
            >
              <FileTypeIcon name={filename} isDirectory={false} size={12} />
              <span className="truncate max-w-[240px] leading-none">{filename}{lineColSuffix}</span>
            </button>
          </TooltipTrigger>
        </ContextMenuTrigger>
        <TooltipContent side="bottom" className="max-w-[400px] break-all font-mono text-[11px]">
          {fileStatus === 'broken' ? inaccessibleFileMessage : displayPath}
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent className="w-48 z-[9999]">
        <ContextMenuItem onClick={handleClick}>
          打开预览
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleShowInFolder}>
          在文件管理器中显示
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

interface ResolvableFilePathChipProps extends FilePathChipProps {
  /** 路径未通过主进程解析时显示的原始 Markdown 节点，避免制造不可用 Chip。 */
  fallback: React.ReactElement
}

/**
 * 用于模型自由文本中的路径候选。只有文件存在且位于当前会话授权范围内时才升级为 Chip；
 * 解析期间和失败后都保留调用方提供的原始 Markdown 外观。
 */
export function ResolvableFilePathChip({ fallback, filePath, basePath, basePaths, sessionId, className }: ResolvableFilePathChipProps): React.ReactElement {
  const [resolution, setResolution] = React.useState<FileReferenceSnapshot | null>(null)
  const candidateBases = React.useMemo<string[]>(() => {
    if (basePaths && basePaths.length > 0) return basePaths.filter(Boolean)
    if (basePath) return [basePath]
    return []
  }, [basePath, basePaths])
  const { resolvedSessionId, authorization, revision } = useFileReferenceContext(sessionId, candidateBases, resolution?.entry.resolvedPath)
  const cleanPath = React.useMemo(() => stripLineCol(filePath.trim()).path, [filePath])
  const snapshotKey = fileReferenceKey(cleanPath, candidateBases, resolvedSessionId, authorization)

  React.useEffect(() => {
    let cancelled = false
    void resolveFileReference(cleanPath, candidateBases, resolvedSessionId, revision)
      .then((entry) => {
        if (!cancelled) setResolution({ key: snapshotKey, entry })
      })
      .catch(() => {
        if (!cancelled) setResolution(null)
      })
    return () => { cancelled = true }
  }, [candidateBases, cleanPath, resolvedSessionId, revision, snapshotKey])

  if (resolution?.key !== snapshotKey || !resolution.entry.exists) return fallback
  return <FilePathChip filePath={filePath} basePath={basePath} basePaths={basePaths} sessionId={resolvedSessionId} className={className} resolution={resolution} />
}

export { isAbsoluteFilePath, isImageFilePath, isLocalFileReference, isRelativeFilePath }
