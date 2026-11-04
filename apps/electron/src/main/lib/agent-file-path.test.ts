import { describe, expect, test } from 'bun:test'
import { normalizeWindowsShellPath } from './agent-file-path'

describe('客户端盘符别名规范化', () => {
  test('given Windows when 引用 Pi 支持的 shell 盘符别名 then 转换为明确盘符路径', () => {
    for (const prefix of ['/d', '/D', '/mnt/d', '/cygdrive/D', '/MNT/D', '/CYGDRIVE/d']) {
      expect(normalizeWindowsShellPath(`${prefix}/Code/中文 (1)/a.ts`, 'win32')).toBe('D:\\Code\\中文 (1)\\a.ts')
      expect(normalizeWindowsShellPath(prefix, 'win32')).toBe('D:\\')
    }
  })

  test('given macOS 或 Linux when 引用类盘符目录 then 保留 POSIX 语义', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      for (const path of ['/d/Code/a.ts', '/mnt/d/a.ts', '/cygdrive/d/a.ts', '/home/a\\b.ts']) {
        expect(normalizeWindowsShellPath(path, platform)).toBe(path)
      }
    }
  })

  test('given 原生路径或未支持的 shell 路径 when 规范化 then 不改写或猜测', () => {
    for (const path of ['D:\\Code\\a.ts', 'D:/Code/a.ts', '\\\\server\\share\\a.ts', '//server/share/a.ts', '/d/Code\\a.ts', '/home/alice/a.ts', '/usr/bin/a', '/mnt/data/a.ts', 'src/a.ts']) {
      expect(normalizeWindowsShellPath(path, 'win32')).toBe(path)
    }
  })
})
