import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { doesFileChangeAffectReference, fileReferenceKey, resolveFileReference } from './file-reference-resolution'
import { isAsyncResultCurrent, stripLineCol } from '../components/ai-elements/file-path-chip-utils'

interface ResolvedFile {
  url: string
  resolvedPath: string
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const resolvePath = mock((_path: string, _access: unknown): Promise<ResolvedFile | null> => Promise.resolve(null))

beforeEach(() => {
  resolvePath.mockReset()
  resolvePath.mockImplementation(() => Promise.resolve(null))
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { electronAPI: { resolveFilePath: resolvePath } } })
})

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('文件引用请求刷新与隔离', () => {
  test('given 未解析成功的引用 when 其他项目或同前缀目录变化 then 不重查；候选根内创建则重查', () => {
    const scope = { directoryRoots: ['/project', '/attached'], attachedFiles: ['/single/a.ts'] }
    expect(doesFileChangeAffectReference(['/other/a.ts', '/project-backup/a.ts'], scope, false)).toBe(false)
    expect(doesFileChangeAffectReference(['/project/new.ts'], scope, false)).toBe(true)
    expect(doesFileChangeAffectReference(['/attached/new.ts'], scope, false)).toBe(true)
    expect(doesFileChangeAffectReference(['/single/a.ts'], scope, false)).toBe(true)
    expect(doesFileChangeAffectReference(['/single/other.ts'], scope, false)).toBe(false)
  })

  test('given 已知实际文件 when 无关文件变化 then 不重查；实际文件或父目录变化则重查', () => {
    const scope = { resolvedPath: '/actual/src/a.ts', directoryRoots: ['/project'], attachedFiles: [] }
    expect(doesFileChangeAffectReference(['/project/b.ts', '/actual/src/b.ts', '/actual/src/a.ts.bak'], scope, false)).toBe(false)
    expect(doesFileChangeAffectReference(['/actual/src/a.ts'], scope, false)).toBe(true)
    expect(doesFileChangeAffectReference(['/actual/src'], scope, false)).toBe(true)
  })

  test('given Windows 大小写与分隔符或 POSIX 反斜杠文件名 when 匹配通知 then 遵守本机路径语义', () => {
    const scope = { resolvedPath: 'D:\\Project\\a.ts', directoryRoots: [], attachedFiles: [] }
    expect(doesFileChangeAffectReference(['d:/project/A.ts'], scope, true)).toBe(true)
    expect(doesFileChangeAffectReference(['D:/Project/b.ts'], scope, true)).toBe(false)
    const posixScope = { resolvedPath: '/project/a\\b.ts', directoryRoots: [], attachedFiles: [] }
    expect(doesFileChangeAffectReference(['/project/a/b.ts', '/Project/a\\b.ts'], posixScope, false)).toBe(false)
    expect(doesFileChangeAffectReference(['/project/a\\b.ts'], posixScope, false)).toBe(true)
    expect(doesFileChangeAffectReference(['/'], posixScope, false)).toBe(true)
  })

  test('given 同一会话的相同引用 when 并发检查 then 合并进行中请求并携带候选根', async () => {
    const pending = Promise.withResolvers<ResolvedFile | null>()
    resolvePath.mockReturnValue(pending.promise)
    const first = resolveFileReference('a.ts', ['/project'], 'session-a', '0')
    const second = resolveFileReference('a.ts', ['/project'], 'session-a', '0')
    expect(first).toBe(second)
    expect(resolvePath).toHaveBeenCalledTimes(1)
    expect(resolvePath).toHaveBeenCalledWith('a.ts', { sessionId: 'session-a', candidateBasePaths: ['/project'] })
    pending.resolve({ url: 'proma-file://test', resolvedPath: '/project/a.ts' })
    expect(await first).toEqual({ exists: true, resolvedPath: '/project/a.ts' })
  })

  test('given 初次不存在 when 文件被创建并再次检查 then 不复用失败结果', async () => {
    expect(await resolveFileReference('a.ts', [], 'session-a', '0')).toEqual({ exists: false })
    resolvePath.mockResolvedValue({ url: 'proma-file://test', resolvedPath: '/project/a.ts' })
    expect(await resolveFileReference('a.ts', [], 'session-a', '0')).toEqual({ exists: true, resolvedPath: '/project/a.ts' })
    expect(resolvePath).toHaveBeenCalledTimes(2)
  })

  test('given 已解析成功 when 删除或撤销授权后悬浮或点击 then 重新检查且返回失败', async () => {
    resolvePath.mockResolvedValueOnce({ url: 'proma-file://test', resolvedPath: '/project/a.ts' })
    expect((await resolveFileReference('a.ts', [], 'session-a', '0')).exists).toBe(true)
    expect((await resolveFileReference('a.ts', [], 'session-a', '0')).exists).toBe(false)
    expect(resolvePath).toHaveBeenCalledTimes(2)
  })

  test('given 旧请求尚未返回 when 会话、候选根或上下文变化 then 独立请求且不被旧结果污染', async () => {
    const oldResult = Promise.withResolvers<ResolvedFile | null>()
    resolvePath.mockReturnValueOnce(oldResult.promise)
    const oldRequest = resolveFileReference('a.ts', ['/old'], 'session-a', '0')
    resolvePath.mockResolvedValue({ url: 'proma-file://new', resolvedPath: '/new/a.ts' })
    await resolveFileReference('a.ts', ['/old'], 'session-b', '0')
    await resolveFileReference('a.ts', ['/new'], 'session-a', '0')
    expect(await resolveFileReference('a.ts', ['/old'], 'session-a', '1')).toEqual({ exists: true, resolvedPath: '/new/a.ts' })
    oldResult.resolve(null)
    await oldRequest
    expect(resolvePath).toHaveBeenCalledTimes(4)
    expect((await resolveFileReference('a.ts', ['/old'], 'session-a', '1')).exists).toBe(true)
  })

  test('given IPC 失败 when 重试 then 不保留失败的进行中请求', async () => {
    resolvePath.mockRejectedValueOnce(new Error('IPC unavailable'))
    await expect(resolveFileReference('a.ts', [], 'session-a', '0')).rejects.toThrow('IPC unavailable')
    expect(await resolveFileReference('a.ts', [], 'session-a', '0')).toEqual({ exists: false })
    expect(resolvePath).toHaveBeenCalledTimes(2)
  })

  test('given 无所属会话 when 解析 then 不借用其他会话的授权', async () => {
    expect(await resolveFileReference('a.ts', [], undefined, '0')).toEqual({ exists: false })
    expect(resolvePath).not.toHaveBeenCalled()
  })

  test('given 行列号或过期组件请求 when 展示与异步完成 then 文件系统路径不带后缀且旧请求无效', () => {
    expect(stripLineCol('D:\\中文 (1)\\a.ts:12:3')).toEqual({ path: 'D:\\中文 (1)\\a.ts', suffix: ':12:3' })
    expect(isAsyncResultCurrent(1, 2, true)).toBe(false)
    expect(isAsyncResultCurrent(2, 2, false)).toBe(false)
    expect(isAsyncResultCurrent(2, 2, true)).toBe(true)
    expect(fileReferenceKey('a.ts', [], 'a', '0')).not.toBe(fileReferenceKey('a.ts', [], 'b', '0'))
  })
})
