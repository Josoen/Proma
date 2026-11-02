import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { serializeCodexCredentials } from '@proma/shared'
import { writeJsonFileAtomic } from './safe-file'

type ChannelManagerModule = typeof import('./channel-manager')

let channelManager: ChannelManagerModule
let tempHome: string
const originalHome = process.env.HOME
const originalPromaDev = process.env.PROMA_DEV

mock.module('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => join(process.env.HOME ?? tempHome, 'Library', 'Application Support'),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf-8'),
  },
  shell: {
    openExternal: async () => undefined,
  },
}))

mock.module('node:os', () => ({
  ...os,
  homedir: () => tempHome,
}))

function writeChannels(channels: unknown[]): void {
  const configDir = join(tempHome, '.proma')
  mkdirSync(configDir, { recursive: true })
  writeJsonFileAtomic(join(configDir, 'channels.json'), { version: 2, channels })
}

beforeAll(async () => {
  tempHome = mkdtempSync(join(os.tmpdir(), 'proma-channel-runtime-key-'))
  process.env.HOME = tempHome
  process.env.PROMA_DEV = '0'
  channelManager = await import('./channel-manager')
})

beforeEach(() => {
  rmSync(join(tempHome, '.proma'), { recursive: true, force: true })
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalPromaDev === undefined) {
    delete process.env.PROMA_DEV
  } else {
    process.env.PROMA_DEV = originalPromaDev
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('默认 DeepSeek 渠道生命周期', () => {
  test('Given 首次使用且没有配置文件 When 获取渠道列表 Then 仅创建一个未启用的 DeepSeek 预设', () => {
    expect(existsSync(join(tempHome, '.proma', 'channels.json'))).toBe(false)
    const channels = channelManager.listChannels()
    expect(channels).toHaveLength(1)
    expect(channels[0]).toMatchObject({ name: 'DeepSeek', provider: 'deepseek', enabled: false })
    expect(channelManager.listChannels().map((channel) => channel.id)).toEqual([channels[0]!.id])
  })

  test('Given 默认 DeepSeek 已创建 When 删除并刷新或重启 Then 保持空列表而不重新创建', () => {
    const preset = channelManager.listChannels()[0]!
    channelManager.deleteChannel(preset.id)
    expect(channelManager.getChannelById(preset.id)).toBeUndefined()
    expect(channelManager.listChannels()).toEqual([])
    expect(channelManager.listChannels()).toEqual([])
    const script = `
      import { mock } from 'bun:test';
      import * as os from 'node:os';
      import { strict as assert } from 'node:assert';
      mock.module('node:os', () => ({ ...os, homedir: () => ${JSON.stringify(tempHome)} }));
      mock.module('electron', () => ({ app: { isPackaged: true }, safeStorage: { isEncryptionAvailable: () => false }, shell: {} }));
      const { listChannels } = await import('./apps/electron/src/main/lib/channel-manager');
      assert.deepEqual(listChannels(), []);
    `
    const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    expect({ exitCode: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ exitCode: 0 })
  })

  test('Given 已有空配置文件 When 获取渠道列表 Then 尊重已保存的空列表', () => {
    writeChannels([])
    expect(channelManager.listChannels()).toEqual([])
    expect(existsSync(join(tempHome, '.proma', 'channels.json'))).toBe(true)
  })

  test('Given 已有其他供应商配置 When 获取渠道列表 Then 保留用户渠道而不补建 DeepSeek', () => {
    writeChannels([{
      id: 'user-channel', name: '我的 API', provider: 'openai', baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key', models: [], enabled: true, createdAt: 1, updatedAt: 1,
    }])
    expect(channelManager.listChannels().map((channel) => channel.id)).toEqual(['user-channel'])
  })
})

describe('渠道运行时认证解析', () => {
  test('Given 历史火山套餐和当前 API 渠道 When 读取配置 Then 清理退休渠道并保留 API 渠道', () => {
    writeChannels(['doubao', 'ark-coding-plan', 'doubao-api'].map((provider) => ({
      id: provider,
      name: provider,
      provider,
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'test-key',
      models: [],
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    })))

    expect(channelManager.getChannelById('doubao')).toBeUndefined()
    expect(channelManager.getChannelById('ark-coding-plan')).toBeUndefined()
    expect(channelManager.getChannelById('doubao-api')?.provider).toBe('doubao-api')
    const saved = JSON.parse(readFileSync(join(tempHome, '.proma', 'channels.json'), 'utf-8')) as {
      channels: Array<{ id: string }>
    }
    expect(saved.channels.map((channel) => channel.id)).toEqual(['doubao-api'])
  })

  test('Given ChatGPT OAuth 渠道 When 解析运行时 key Then 返回 access token 而不是凭据 JSON', async () => {
    writeChannels([
      {
        id: 'codex-channel',
        name: 'ChatGPT',
        provider: 'openai-codex',
        baseUrl: '',
        apiKey: serializeCodexCredentials({
          access: 'oauth-access-token',
          refresh: 'oauth-refresh-token',
          expires: Date.now() + 3_600_000,
        }),
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('codex-channel'))
      .resolves.toBe('oauth-access-token')
  })

  test('Given 普通渠道 When 解析运行时 key Then 返回解密后的 API Key', async () => {
    writeChannels([
      {
        id: 'api-key-channel',
        name: 'Anthropic',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'plain-api-key',
        models: [],
        enabled: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ])

    await expect(channelManager.resolveChannelRuntimeApiKey('api-key-channel'))
      .resolves.toBe('plain-api-key')
  })
})
