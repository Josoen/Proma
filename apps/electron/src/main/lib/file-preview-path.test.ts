import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isAbsolutePreviewPath, resolveFilePath, resolveTargetPath } from './file-preview-service'

describe('文件引用公共解析', () => {
  test('given 已存在的文件 when 使用原生路径、相对路径和 shell 别名 then 指向同一文件', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-file-reference-'))
    try {
      const file = join(root, '中文 空格 (1).ts')
      writeFileSync(file, 'export {}')
      expect(resolveFilePath(file)).toBe(file)
      expect(resolveFilePath('./中文 空格 (1).ts', [root])).toBe(file)
      if (process.platform === 'win32') {
        const drive = file[0]!.toLowerCase()
        const tail = file.slice(3).replace(/\\/g, '/')
        for (const prefix of [`/${drive}`, `/mnt/${drive}`, `/cygdrive/${drive}`]) {
          expect(resolveTargetPath(`${prefix}/${tail}`)).toBe(file)
          expect(resolveFilePath(`${prefix}/${tail}`)).toBe(file)
        }
      } else {
        const backslashFile = join(root, 'a\\b.ts')
        writeFileSync(backslashFile, '')
        expect(resolveFilePath(backslashFile)).toBe(backslashFile)
        expect(isAbsolutePreviewPath('D:/Code/a.ts')).toBe(false)
        expect(isAbsolutePreviewPath('\\\\server\\share\\a.ts')).toBe(false)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test('given 多个候选根 when 相对引用 then 保留顺序且不跨出候选根', () => {
    const root = mkdtempSync(join(tmpdir(), 'proma-file-reference-'))
    try {
      const first = join(root, 'first')
      const second = join(root, 'second')
      mkdirSync(first)
      mkdirSync(second)
      writeFileSync(join(second, 'a.ts'), '')
      expect(resolveFilePath('a.ts', [first, second])).toBe(join(second, 'a.ts'))
      writeFileSync(join(first, 'a.ts'), '')
      expect(resolveFilePath('a.ts', [first, second])).toBe(join(first, 'a.ts'))
      expect(resolveFilePath('../second/a.ts', [first])).toBeNull()
      expect(resolveTargetPath('a.ts')).toBe('')
      expect(resolveTargetPath('a\0.ts', [root])).toBe('')
      expect(resolveTargetPath('~/project/a.ts')).toBe(resolve(homedir(), 'project/a.ts'))
      expect(resolveTargetPath('~/project/a\\b.ts')).toBe(resolve(homedir(), 'project/a\\b.ts'))
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
