/**
 * models.dev 模型默认目录。
 *
 * 目录只提供模型元数据，不决定某个 API Key 是否真的可以调用模型；
 * 真实可用模型仍由供应商发现接口或 OAuth 账号返回。
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file'
import type {
  AgentThinkingLevel,
  ModelsDevCatalogStatus,
  ModelsDevLookupInput,
  ModelsDevModelInfo,
  ProviderType,
} from '@proma/shared'
import { getEffectiveProxyUrl, redactProxyUrl } from './proxy-settings-service'
import { getFetchFn } from './proxy-fetch'

export const MODELS_DEV_API_URL = 'https://models.dev/api.json'
// api.json 体积约 6 MB；代理链路较慢时，短超时会把正常下载误判为失败。
const MODELS_DEV_TIMEOUT_MS = 120_000
const MODELS_DEV_MAX_BYTES = 32 * 1024 * 1024
const THINKING_LEVELS: readonly AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

type JsonRecord = Record<string, unknown>

interface ModelsDevModelRecord {
  id: string
  name?: string
  reasoning?: boolean
  reasoning_options?: unknown
  modalities?: { input?: unknown; output?: unknown }
  limit?: { context?: unknown; output?: unknown }
}

interface ModelsDevProviderRecord {
  api?: unknown
  models?: Record<string, ModelsDevModelRecord>
}

interface ModelsDevCacheFile {
  fetchedAt: number
  data: JsonRecord
}

const PROVIDER_KEYS: Partial<Record<ProviderType, readonly string[]>> = {
  anthropic: ['anthropic'],
  'anthropic-compatible': ['anthropic'],
  openai: ['openai'],
  'openai-responses': ['openai'],
  deepseek: ['deepseek'],
  google: ['google', 'google-vertex'],
  'kimi-api': ['moonshotai-cn', 'moonshotai'],
  'kimi-coding': ['kimi-coding', 'moonshotai-cn', 'moonshotai'],
  zhipu: ['zai', 'zhipuai'],
  'zhipu-coding': ['zai-coding-cn', 'zai-coding-plan', 'zai'],
  'zhipu-coding-team': ['zai-coding-cn', 'zai-coding-plan', 'zai'],
  minimax: ['minimax', 'minimax-cn'],
  'doubao-api': ['volcengine'],
  qwen: ['alibaba'],
  'qwen-anthropic': ['alibaba'],
  'qwen-token-plan': ['alibaba-token-plan'],
  xiaomi: ['xiaomi'],
  'xiaomi-token-plan': ['xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams', 'xiaomi'],
  custom: [],
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function normalizeThinkingLevel(value: string): AgentThinkingLevel | undefined {
  if (value === 'none') return 'off'
  return (THINKING_LEVELS as readonly string[]).includes(value) ? value as AgentThinkingLevel : undefined
}

function thinkingLevels(record: ModelsDevModelRecord): AgentThinkingLevel[] {
  if (record.reasoning !== true) return ['off']
  const levels = new Set<AgentThinkingLevel>()
  const options = Array.isArray(record.reasoning_options) ? record.reasoning_options : []
  for (const option of options) {
    const item = asRecord(option)
    const type = typeof item?.type === 'string' ? item.type : ''
    if (type === 'toggle' || type === 'budget_tokens') {
      levels.add('off')
      levels.add('medium')
    }
    for (const raw of stringArray(item?.values)) {
      const level = normalizeThinkingLevel(raw)
      if (level) levels.add(level)
    }
  }
  if (levels.size === 0) return ['off', 'low', 'medium', 'high']
  return THINKING_LEVELS.filter((level) => levels.has(level))
}

function modelInfo(providerKey: string, model: ModelsDevModelRecord): ModelsDevModelInfo {
  const inputModalities = stringArray(recordModalities(model.modalities, 'input'))
  const contextWindow = positiveInteger(model.limit?.context)
  const maxTokens = positiveInteger(model.limit?.output)
  return {
    id: model.id,
    name: model.name?.trim() || model.id,
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    thinkingLevels: thinkingLevels(model),
    ...(inputModalities.includes('image') ? { supportsImages: true } : {}),
    ...(inputModalities.includes('pdf') ? { supportsDocuments: true } : {}),
    source: 'models.dev',
  }
}

function recordModalities(modalities: ModelsDevModelRecord['modalities'], side: 'input' | 'output'): unknown {
  return modalities?.[side]
}

function providerKeyFor(input: ModelsDevLookupInput): string | undefined {
  const candidates = PROVIDER_KEYS[input.provider]
  if (candidates && candidates.length > 0) return candidates[0]
  try {
    const host = new URL(input.baseUrl).hostname.toLowerCase()
    if (host.includes('anthropic')) return 'anthropic'
    if (host.includes('openai')) return 'openai'
    if (host.includes('deepseek')) return 'deepseek'
    if (host.includes('moonshot') || host.includes('kimi')) return 'moonshotai'
    if (host.includes('bigmodel') || host.includes('zai')) return 'zai'
  } catch {
    // 自定义地址无法解析时只尝试全局唯一模型。
  }
  return undefined
}

/**
 * models.dev 同一模型经常同时出现在官方发布方和多个聚合/转售方。
 * 对常见官方模型 ID 先锁定其发布方，避免把多个转售记录当成歧义而放弃。
 */
function modelOwnerKeys(modelId: string): readonly string[] {
  const id = modelId.trim().toLowerCase()
  if (/^(gpt|o[1-9]|chatgpt|text-)/.test(id) || id.startsWith('openai/')) return ['openai']
  if (id.includes('claude')) return ['anthropic']
  if (id.includes('deepseek')) return ['deepseek']
  if (id.includes('gemini') || id.includes('gemma')) return ['google']
  if (id.includes('glm-')) return ['zai', 'zhipuai']
  if (id.startsWith('kimi-') || id.startsWith('moonshot-')) return ['moonshotai', 'moonshotai-cn']
  if (id.startsWith('qwen')) return ['alibaba']
  if (id.startsWith('mimo-')) return ['xiaomi']
  return []
}

function bundledCatalogPath(): string {
  const isPackaged = app?.isPackaged === true
  return isPackaged
    ? join(process.resourcesPath ?? __dirname, 'models.dev', 'api.json')
    : join(__dirname, 'resources', 'models.dev', 'api.json')
}

function cachePath(): string | undefined {
  const userData = app?.getPath?.('userData')
  return userData ? join(userData, 'models-dev', 'catalog.json') : undefined
}

class ModelsDevCatalog {
  private data: JsonRecord | null = null
  private fetchedAt: number | undefined
  private source: ModelsDevCatalogStatus['source'] = 'empty'
  private lastError: string | undefined

  async ensureLoaded(): Promise<void> {
    if (this.data) return

    const cachedPath = cachePath()
    const cached = cachedPath ? readJsonFileSafe<ModelsDevCacheFile>(cachedPath) : null
    if (cached?.data && asRecord(cached.data)) {
      this.data = cached.data
      this.fetchedAt = cached.fetchedAt
      this.source = 'cache'
      return
    }

    const path = bundledCatalogPath()
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
        const record = asRecord(parsed)
        if (record) {
          this.data = record
          this.source = 'bundled'
          return
        }
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error)
      }
    }
    this.data = {}
    this.source = 'empty'
  }

  async refresh(): Promise<ModelsDevCatalogStatus> {
    const startedAt = Date.now()
    let stage = '读取代理配置'
    let proxyUrl: string | undefined
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS)
    try {
      // 模型目录同步与供应商请求一样遵循 Proma 的代理设置；不携带任何渠道凭据。
      proxyUrl = await getEffectiveProxyUrl()
      stage = '请求目录响应'
      const response = await getFetchFn(proxyUrl)(MODELS_DEV_API_URL, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`models.dev 返回 HTTP ${response.status}`)
      stage = '读取目录内容'
      const contentLength = Number(response.headers.get('content-length') ?? 0)
      if (contentLength > MODELS_DEV_MAX_BYTES) {
        throw new Error(`目录响应过大（${Math.round(contentLength / 1024 / 1024)} MB）`)
      }
      const body = await response.text()
      if (new TextEncoder().encode(body).byteLength > MODELS_DEV_MAX_BYTES) {
        throw new Error(`目录响应过大（超过 ${MODELS_DEV_MAX_BYTES / 1024 / 1024} MB）`)
      }
      stage = '解析目录 JSON'
      const parsed = asRecord(JSON.parse(body) as unknown)
      if (!parsed) throw new Error('models.dev 返回的数据格式无效')
      const fetchedAt = Date.now()
      const userData = app?.getPath?.('userData')
      if (!userData) throw new Error('当前运行时不支持写入 models.dev 缓存')
      const targetPath = join(userData, 'models-dev', 'catalog.json')
      mkdirSync(join(userData, 'models-dev'), { recursive: true })
      writeJsonFileAtomic(targetPath, { fetchedAt, data: parsed })
      this.data = parsed
      this.fetchedAt = fetchedAt
      this.source = 'remote'
      this.lastError = undefined
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const detail = error instanceof DOMException && error.name === 'AbortError'
        ? `请求超时（${MODELS_DEV_TIMEOUT_MS / 1000} 秒）`
        : message
      const proxyLabel = proxyUrl ? `，代理 ${redactProxyUrl(proxyUrl)}` : '，未使用代理'
      this.lastError = `${stage}失败：${detail}（耗时 ${Date.now() - startedAt} ms${proxyLabel}）`
      console.error('[models.dev] 同步失败:', this.lastError)
      await this.ensureLoaded()
    } finally {
      clearTimeout(timer)
    }
    return this.getStatus()
  }

  getStatus(): ModelsDevCatalogStatus {
    const data = this.data ?? {}
    let providerCount = 0
    let modelCount = 0
    for (const value of Object.values(data)) {
      const provider = asRecord(value) as ModelsDevProviderRecord | null
      if (!provider) continue
      providerCount += 1
      modelCount += provider.models ? Object.keys(provider.models).length : 0
    }
    return {
      loaded: this.data !== null,
      source: this.source,
      ...(this.fetchedAt ? { fetchedAt: this.fetchedAt } : {}),
      providerCount,
      modelCount,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    }
  }

  async lookup(input: ModelsDevLookupInput): Promise<ModelsDevModelInfo | null> {
    await this.ensureLoaded()
    const modelId = input.modelId.trim()
    if (!modelId) return null
    const providers = this.data ?? {}
    const preferredKeys = PROVIDER_KEYS[input.provider] ?? []
    const candidates: Array<{ providerKey: string; model: ModelsDevModelRecord }> = []
    // 模型自身的官方 owner 优先于当前渠道协议。这样自定义 Anthropic/OpenAI
    // 中转使用 gpt-6.1-terra 时仍能拿到 models.dev 的 OpenAI 发布记录。
    const exactKeys = [...modelOwnerKeys(modelId), ...preferredKeys]
    const inferredKey = providerKeyFor(input)
    if (inferredKey && !exactKeys.includes(inferredKey)) exactKeys.push(inferredKey)

    for (const key of exactKeys) {
      const provider = asRecord(providers[key]) as ModelsDevProviderRecord | null
      const models = provider?.models
      if (!models) continue
      const model = Object.values(models).find((item) => item.id?.toLowerCase() === modelId.toLowerCase())
      if (model) candidates.push({ providerKey: key, model })
    }

    if (candidates.length === 0) {
      for (const [key, value] of Object.entries(providers)) {
        const provider = asRecord(value) as ModelsDevProviderRecord | null
        const model = provider?.models && Object.values(provider.models)
          .find((item) => item.id?.toLowerCase() === modelId.toLowerCase())
        if (model) candidates.push({ providerKey: key, model })
      }
    }

    if (candidates.length > 0) {
      const ownerKeys = new Set(modelOwnerKeys(modelId))
      const ownerCandidate = candidates.find((candidate) => ownerKeys.has(candidate.providerKey))
      if (ownerCandidate) return modelInfo(ownerCandidate.providerKey, ownerCandidate.model)
    }

    if (candidates.length === 1) return modelInfo(candidates[0]!.providerKey, candidates[0]!.model)
    // 未命中或多个发布方冲突时不合成通用记录，避免把 Proma 兜底值伪装成目录发布值。
    return null
  }
}

export const modelsDevCatalog = new ModelsDevCatalog()

export async function lookupModelsDevModel(input: ModelsDevLookupInput): Promise<ModelsDevModelInfo | null> {
  return modelsDevCatalog.lookup(input)
}

export function getModelsDevCatalogStatus(): ModelsDevCatalogStatus {
  return modelsDevCatalog.getStatus()
}
