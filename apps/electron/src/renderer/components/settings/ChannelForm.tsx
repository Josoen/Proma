/**
 * ChannelForm - 模型配置编辑表单
 *
 * 支持创建和编辑模型配置，包含：
 * - 基本信息（名称、供应商、Base URL、API Key）
 * - 模型列表：已启用模型置顶 + 可用模型搜索
 * - 连接测试
 *
 * 编辑模式下修改即时保存（auto-save），创建模式仍需手动提交。
 */

import * as React from 'react'
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Plus,
  X,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Download,
  Search,
  ChevronDown,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { useSetAtom } from 'jotai'
import { channelFormDirtyAtom } from '@/atoms/settings-tab'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  PROVIDER_DEFAULT_URLS,
  PROVIDER_LABELS,
  parseZhipuTeamCredentials,
  parseCodexCredentials,
  parseGithubCopilotCredentials,
  parseXaiCredentials,
} from '@proma/shared'
import type {
  Channel,
  ChannelCreateInput,
  ChannelModel,
  ChannelTestResult,
  CodexOAuthDeviceCode,
  GithubCopilotOAuthDeviceCode,
  FetchModelsResult,
  ModelsDevCatalogStatus,
  ModelsDevModelInfo,
  ProviderType,
  XaiOAuthDeviceCode,
} from '@proma/shared'
import {
  resolveAnthropicMessagesUrl,
  resolveOpenAIChatCompletionsUrl,
  resolveOpenAIResponsesUrl,
} from '@proma/core'
import { getProviderLogo } from '@/lib/model-logo'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  SettingsSection,
  SettingsCard,
  SettingsInput,
  SettingsSelect,
  SettingsToggle,
} from './primitives'

interface ChannelFormProps {
  /** 编辑模式下传入已有渠道，创建模式传 null */
  channel: Channel | null
  onSaved: (channel?: Channel) => void
  onCancel: () => void
}

/** 所有可选供应商（'qwen-anthropic' 仅为兼容存量 Anthropic 渠道保留，不再出现在新建下拉） */
const PROVIDER_OPTIONS: ProviderType[] = ['anthropic', 'anthropic-compatible', 'openai', 'openai-responses', 'openai-codex', 'github-copilot', 'xai', 'deepseek', 'google', 'kimi-api', 'kimi-coding', 'zhipu', 'zhipu-coding', 'zhipu-coding-team', 'doubao-api', 'minimax', 'qwen', 'qwen-token-plan', 'xiaomi', 'xiaomi-token-plan', 'custom']

/** 需要用 messages 端点测试的供应商预设模型 */
const PROVIDER_TEST_MODEL_PRESETS: Partial<Record<ProviderType, string[]>> = {
  deepseek: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-flash', 'deepseek-v4-flash-vision-exp'],
  'kimi-api': ['kimi-k3', 'kimi-k2.6'],
  xiaomi: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'],
  'xiaomi-token-plan': ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'],
  'qwen-token-plan': ['qwen3.8-max-preview', 'qwen3.7-max', 'qwen3.7-flash', 'qwen3.6-flash'],
}

/** 供应商选项（用于 SettingsSelect） */
const PROVIDER_SELECT_OPTIONS = PROVIDER_OPTIONS.map((p) => ({
  value: p,
  label: PROVIDER_LABELS[p],
  icon: getProviderLogo(p),
}))

function resolveDirectTestModelId(provider: ProviderType, models: ChannelModel[]): string | undefined {
  if (!PROVIDER_TEST_MODEL_PRESETS[provider]) return undefined
  const configuredModelId = models.find((model) => model.enabled)?.id ?? models[0]?.id
  if (configuredModelId) return configuredModelId
  return PROVIDER_TEST_MODEL_PRESETS[provider]?.[0]
}

/** 走 Anthropic 协议的供应商集合（共用 /v1/messages 端点） */
const ANTHROPIC_PROTOCOL_PROVIDERS: ReadonlySet<ProviderType> = new Set<ProviderType>([
  'anthropic',
  'anthropic-compatible',
  'deepseek',
  'kimi-api',
  'kimi-coding',
  'zhipu-coding',
  'zhipu-coding-team',
  'minimax',
  'xiaomi',
  'xiaomi-token-plan',
  'qwen-anthropic',
  'qwen-token-plan',
])

/**
 * 生成 API 端点预览 URL
 *
 * 与运行时 channel-manager / ProviderAdapter 的端点解析逻辑保持一致。
 */
function buildPreviewUrl(baseUrl: string, provider: ProviderType): string {
  if (ANTHROPIC_PROTOCOL_PROVIDERS.has(provider)) {
    return resolveAnthropicMessagesUrl(baseUrl, provider)
  }
  if (provider === 'google') {
    return `${baseUrl.trim().replace(/\/+$/, '')}/v1beta/models/{model}:generateContent`
  }
  if (provider === 'openai-responses') {
    return resolveOpenAIResponsesUrl(baseUrl, provider)
  }
  return resolveOpenAIChatCompletionsUrl(baseUrl, provider)
}

function getUrlInputLabel(provider: ProviderType): string {
  return provider === 'custom' || provider === 'anthropic-compatible' ? '请求地址' : 'Base URL'
}

function getUrlInputPlaceholder(provider: ProviderType): string {
  if (provider === 'custom') return 'https://api.example.com/v2（Chat 按原样请求）'
  if (provider === 'openai-responses') return 'https://api.example.com/v1/responses'
  if (provider === 'anthropic-compatible') return 'https://api.example.com/v1/messages'
  return 'https://api.example.com'
}

function getApiKeyPlaceholder(provider: ProviderType, isEdit: boolean): string {
  if (isEdit) return '留空则不更新'
  if (provider === 'zhipu-coding-team') {
    return '输入 API Token'
  }
  return '输入 API Key'
}

interface ZhipuTeamSecretForm {
  apiKey: string
  organization: string
  project: string
}

const EMPTY_ZHIPU_TEAM_SECRET: ZhipuTeamSecretForm = {
  apiKey: '',
  organization: '',
  project: '',
}

function parseZhipuTeamSecret(secret: string): Partial<ZhipuTeamSecretForm> {
  const credentials = parseZhipuTeamCredentials(secret)
  if (!credentials) return {}
  return {
    apiKey: credentials.apiKey,
    organization: credentials.organization ?? '',
    project: credentials.project ?? '',
  }
}

function buildZhipuTeamSecret(secret: ZhipuTeamSecretForm): string {
  const payload: Record<string, string> = {}
  if (secret.apiKey.trim()) payload.apiKey = secret.apiKey.trim()
  if (secret.organization.trim()) payload.organization = secret.organization.trim()
  if (secret.project.trim()) payload.project = secret.project.trim()
  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : ''
}

/** auto-save 防抖延迟 */
const AUTO_SAVE_DELAY = 600
const THINKING_LEVEL_OPTIONS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const CONTEXT_WINDOW_PRESETS = [128_000, 200_000, 1_000_000]
const MAX_OUTPUT_PRESETS = [8_192, 32_000, 64_000, 128_000]

function formatTokenCount(value: number | undefined): string {
  if (!value || value <= 0) return '-'
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

function applyModelsDevInfo(model: ChannelModel, info: ModelsDevModelInfo): ChannelModel {
  const next: ChannelModel = { ...model }
  if (next.contextWindowSource !== 'user' && (info.source === 'models.dev' || next.contextWindow === undefined)) {
    next.contextWindow = info.contextWindow
    if (info.source === 'models.dev') next.contextWindowSource = 'catalog'
  }
  if (next.maxTokensSource !== 'user' && (info.source === 'models.dev' || next.maxTokens === undefined)) {
    next.maxTokens = info.maxTokens
    if (info.source === 'models.dev') next.maxTokensSource = 'catalog'
  }
  if (!next.thinkingLevels || next.thinkingLevels.length === 0) {
    next.thinkingLevels = [...info.thinkingLevels]
  }
  if (next.defaultThinkingLevel === undefined) {
    next.defaultThinkingLevel = info.thinkingLevels.includes('medium')
      ? 'medium'
      : (info.thinkingLevels[0] ?? 'off')
  }
  if (next.supportsImages === undefined) next.supportsImages = info.supportsImages ?? null
  if (next.supportsDocuments === undefined) next.supportsDocuments = info.supportsDocuments ?? null
  return next
}

/** 目录失去记录时清掉此前跟随目录的值，运行时再使用通用兜底；用户覆盖保持不动。 */
function clearMissingModelsDevInfo(model: ChannelModel): ChannelModel {
  const next: ChannelModel = { ...model }
  if (next.contextWindowSource === 'catalog') {
    next.contextWindow = undefined
    next.contextWindowSource = undefined
  }
  if (next.maxTokensSource === 'catalog') {
    next.maxTokens = undefined
    next.maxTokensSource = undefined
  }
  return next
}

export function ChannelForm({ channel, onSaved, onCancel }: ChannelFormProps): React.ReactElement {
  const isEdit = channel !== null

  // 表单状态
  const [name, setName] = React.useState(channel?.name ?? '')
  const [provider, setProvider] = React.useState<ProviderType>(channel?.provider ?? 'anthropic')
  const [baseUrl, setBaseUrl] = React.useState(channel?.baseUrl ?? PROVIDER_DEFAULT_URLS.anthropic)
  const [apiKey, setApiKey] = React.useState('')
  const [zhipuTeamSecret, setZhipuTeamSecret] = React.useState<ZhipuTeamSecretForm>(EMPTY_ZHIPU_TEAM_SECRET)
  const [showApiKey, setShowApiKey] = React.useState(false)
  const [models, setModels] = React.useState<ChannelModel[]>(channel?.models ?? [])
  const [enabled, setEnabled] = React.useState(channel?.enabled ?? true)

  // 新模型输入
  const [newModelId, setNewModelId] = React.useState('')
  const [newModelName, setNewModelName] = React.useState('')
  const [expandedModelId, setExpandedModelId] = React.useState<string | null>(null)
  const [modelsDevStatus, setModelsDevStatus] = React.useState<ModelsDevCatalogStatus | null>(null)
  const [refreshingModelsDev, setRefreshingModelsDev] = React.useState(false)
  const catalogEnrichedRef = React.useRef(false)

  // 模型搜索过滤
  const [modelFilter, setModelFilter] = React.useState('')

  // UI 状态
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<ChannelTestResult | null>(null)
  const [fetchingModels, setFetchingModels] = React.useState(false)
  const [fetchResult, setFetchResult] = React.useState<FetchModelsResult | null>(null)
  const [apiKeyLoaded, setApiKeyLoaded] = React.useState(false)
  const [showExitDialog, setShowExitDialog] = React.useState(false)
  const [codexLoggingIn, setCodexLoggingIn] = React.useState(false)
  const [codexDeviceCode, setCodexDeviceCode] = React.useState<CodexOAuthDeviceCode | null>(null)
  const [githubCopilotLoggingIn, setGithubCopilotLoggingIn] = React.useState(false)
  const [githubCopilotDeviceCode, setGithubCopilotDeviceCode] = React.useState<GithubCopilotOAuthDeviceCode | null>(null)
  const [githubCopilotEnterpriseUrl, setGithubCopilotEnterpriseUrl] = React.useState('')
  const [xaiLoggingIn, setXaiLoggingIn] = React.useState(false)
  const [xaiDeviceCode, setXaiDeviceCode] = React.useState<XaiOAuthDeviceCode | null>(null)

  const setChannelFormDirty = useSetAtom(channelFormDirtyAtom)
  const codexLoggingInRef = React.useRef(false)
  const githubCopilotLoggingInRef = React.useRef(false)
  const xaiLoggingInRef = React.useRef(false)

  React.useEffect(() => {
    codexLoggingInRef.current = codexLoggingIn
  }, [codexLoggingIn])

  React.useEffect(() => {
    githubCopilotLoggingInRef.current = githubCopilotLoggingIn
  }, [githubCopilotLoggingIn])

  React.useEffect(() => {
    xaiLoggingInRef.current = xaiLoggingIn
  }, [xaiLoggingIn])

  React.useEffect(() => {
    return window.electronAPI.onCodexOAuthDeviceCode(setCodexDeviceCode)
  }, [])

  React.useEffect(() => {
    return window.electronAPI.onGithubCopilotOAuthDeviceCode(setGithubCopilotDeviceCode)
  }, [])

  React.useEffect(() => {
    return window.electronAPI.onXaiOAuthDeviceCode(setXaiDeviceCode)
  }, [])

  // 关闭或放弃表单时取消仍在轮询的 device-code 授权，避免后台孤立请求。
  React.useEffect(() => () => {
    if (codexLoggingInRef.current) void window.electronAPI.codexOAuthCancel()
    if (githubCopilotLoggingInRef.current) void window.electronAPI.githubCopilotOAuthCancel()
    if (xaiLoggingInRef.current) void window.electronAPI.xaiOAuthCancel()
  }, [])

  /** 编辑模式下加载明文 API Key */
  React.useEffect(() => {
    if (isEdit && channel && !apiKeyLoaded) {
      window.electronAPI.decryptApiKey(channel.id).then((key) => {
        setApiKey(key)
        if (channel.provider === 'zhipu-coding-team') {
          setZhipuTeamSecret({ ...EMPTY_ZHIPU_TEAM_SECRET, ...parseZhipuTeamSecret(key) })
        }
        if (channel.provider === 'github-copilot') {
          setGithubCopilotEnterpriseUrl(parseGithubCopilotCredentials(key)?.enterpriseUrl ?? '')
        }
        setApiKeyLoaded(true)
      }).catch((error) => {
        console.error('[模型配置表单] 解密 API Key 失败:', error)
        setApiKeyLoaded(true)
      })
    }
  }, [isEdit, channel, apiKeyLoaded])

  React.useEffect(() => {
    window.electronAPI.modelsDevStatus()
      .then(setModelsDevStatus)
      .catch((error) => console.warn('[模型配置表单] 读取 models.dev 状态失败:', error))
  }, [])

  React.useEffect(() => {
    if (catalogEnrichedRef.current || models.length === 0) return
    catalogEnrichedRef.current = true
    void window.electronAPI.modelsDevLookupMany(
      models.map((model) => ({ provider, baseUrl, modelId: model.id })),
    ).then((result) => {
      setModels((current) => current.map((model) => {
        const info = result.infos[model.id]
        return info ? applyModelsDevInfo(model, info) : clearMissingModelsDevInfo(model)
      }))
    }).catch((error) => {
      catalogEnrichedRef.current = false
      console.warn('[模型配置表单] 初始化 models.dev 信息失败:', error)
    })
  }, [models, provider, baseUrl])

  const isZhipuTeamProvider = provider === 'zhipu-coding-team'
  const isCodexProvider = provider === 'openai-codex'
  const isGithubCopilotProvider = provider === 'github-copilot'
  const isXaiProvider = provider === 'xai'
  const isSubscriptionProvider = isCodexProvider || isGithubCopilotProvider || isXaiProvider
  const effectiveApiKey = isZhipuTeamProvider ? buildZhipuTeamSecret(zhipuTeamSecret) : apiKey
  // 订阅渠道的 apiKey state 存的是登录后拿到的凭据 JSON；能解析出有效凭据即视为已登录。
  const codexCredentials = isCodexProvider ? parseCodexCredentials(apiKey) : null
  const githubCopilotCredentials = isGithubCopilotProvider ? parseGithubCopilotCredentials(apiKey) : null
  const xaiCredentials = isXaiProvider ? parseXaiCredentials(apiKey) : null
  const hasRequiredSecret = isZhipuTeamProvider
    ? Boolean(zhipuTeamSecret.apiKey.trim())
    : isCodexProvider
      ? Boolean(codexCredentials)
      : isGithubCopilotProvider
        ? Boolean(githubCopilotCredentials)
        : isXaiProvider
        ? Boolean(xaiCredentials)
        : Boolean(apiKey.trim())
  const updateZhipuTeamSecret = React.useCallback((patch: Partial<ZhipuTeamSecretForm>) => {
    setZhipuTeamSecret((prev) => {
      const next = { ...prev, ...patch }
      setApiKey(buildZhipuTeamSecret(next))
      return next
    })
  }, [])

  // ===== Auto-save（仅编辑模式） =====
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 初始化完成标志，避免加载时触发 auto-save */
  const initializedRef = React.useRef(false)

  /** 执行 auto-save */
  const doAutoSave = React.useCallback(async (
    currentModels: ChannelModel[],
    currentName: string,
    currentProvider: ProviderType,
    currentBaseUrl: string,
    currentApiKey: string,
    currentEnabled: boolean,
  ) => {
    if (!isEdit || !channel) return
    try {
      const savedChannel = await window.electronAPI.updateChannel(channel.id, {
        name: currentName,
        provider: currentProvider,
        baseUrl: currentBaseUrl,
        apiKey: currentApiKey || undefined,
        models: currentModels,
        enabled: currentEnabled,
      })
      toast.success('已保存', { id: 'auto-save-success' })
    } catch (error) {
      console.error('[模型配置表单] auto-save 失败:', error)
      toast.error('自动保存失败，请检查后手动重试', { id: 'auto-save-error' })
    }
  }, [isEdit, channel])

  /** 触发防抖 auto-save */
  const scheduleAutoSave = React.useCallback((
    nextModels: ChannelModel[],
    nextName: string,
    nextProvider: ProviderType,
    nextBaseUrl: string,
    nextApiKey: string,
    nextEnabled: boolean,
  ) => {
    if (!isEdit || !initializedRef.current) return
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => {
      doAutoSave(nextModels, nextName, nextProvider, nextBaseUrl, nextApiKey, nextEnabled)
    }, AUTO_SAVE_DELAY)
  }, [isEdit, doAutoSave])

  // API Key 加载完成后标记初始化
  React.useEffect(() => {
    if (isEdit && apiKeyLoaded) {
      // 延迟标记，避免加载时触发
      const t = setTimeout(() => { initializedRef.current = true }, 100)
      return () => clearTimeout(t)
    }
    if (!isEdit) {
      initializedRef.current = true
    }
  }, [isEdit, apiKeyLoaded])

  // 监听字段变化触发 auto-save
  React.useEffect(() => {
    scheduleAutoSave(
      models,
      name,
      provider,
      baseUrl,
      effectiveApiKey,
      enabled,
    )
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  }, [models, name, provider, baseUrl, effectiveApiKey, enabled, scheduleAutoSave])

  // 切换供应商时自动更新 Base URL 与名称，并为支持的渠道自动添加预设模型
  const handleProviderChange = (newProvider: string): void => {
    const p = newProvider as ProviderType
    catalogEnrichedRef.current = false
    // 若 name 为空或仍是上一个 provider 的默认名称，则用新 provider 的名称覆盖；用户手动改过的 name 不动
    const trimmedName = name.trim()
    if (!trimmedName || trimmedName === PROVIDER_LABELS[provider]) {
      setName(PROVIDER_LABELS[p])
    }
    setProvider(p)
    setBaseUrl(PROVIDER_DEFAULT_URLS[p])
    setTestResult(null)
    setFetchResult(null)
    if (p === 'zhipu-coding-team') {
      const parsed = parseZhipuTeamSecret(apiKey)
      setZhipuTeamSecret({ ...EMPTY_ZHIPU_TEAM_SECRET, ...parsed })
      setApiKey(buildZhipuTeamSecret({ ...EMPTY_ZHIPU_TEAM_SECRET, ...parsed }))
    } else if (provider === 'zhipu-coding-team') {
      setApiKey(zhipuTeamSecret.apiKey)
      setZhipuTeamSecret(EMPTY_ZHIPU_TEAM_SECRET)
    }
    // 预设模型：首次切换到对应 provider 且无模型时自动填充
    if (models.length === 0) {
      if (p === 'deepseek') {
        setModels([
          { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', enabled: true },
          { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', enabled: true },
          { id: 'deepseek-flash', name: 'DeepSeek Flash', enabled: true },
          { id: 'deepseek-v4-flash-vision-exp', name: 'DeepSeek V4 Flash Vision Exp', enabled: true },
        ])
      } else if (p === 'kimi-api') {
        setModels([
          { id: 'kimi-k3', name: 'Kimi K3', enabled: true },
          { id: 'kimi-k2.6', name: 'Kimi K2.6', enabled: true },
        ])
      } else if (p === 'kimi-coding') {
        setModels([
          { id: 'k3', name: 'Kimi K3', enabled: true },
          { id: 'kimi-for-coding', name: 'Kimi for Coding', enabled: true },
        ])
      } else if (p === 'zhipu' || p === 'zhipu-coding' || p === 'zhipu-coding-team') {
        setModels([
          { id: 'glm-5.3', name: 'GLM-5.3', enabled: true },
          { id: 'glm-5.3-flash', name: 'GLM-5.3-Flash', enabled: true },
          { id: 'glm-5.3-flashx', name: 'GLM-5.3-FlashX', enabled: true },
          { id: 'glm-5.1', name: 'GLM-5.1', enabled: false },
        ])
      } else if (p === 'minimax') {
        setModels([
          { id: 'MiniMax-M3', name: 'MiniMax-M3', enabled: true },
          { id: 'MiniMax-M2.7', name: 'MiniMax-M2.7', enabled: true },
        ])
      } else if (p === 'xiaomi' || p === 'xiaomi-token-plan') {
        setModels([
          { id: 'mimo-v2.6-pro', name: 'MiMo V2.6 Pro', enabled: true },
          { id: 'mimo-v2.6-flash', name: 'MiMo V2.6 Flash', enabled: true },
          { id: 'mimo-v2.6-pro-ultraspeed', name: 'MiMo V2.6 Pro UltraSpeed', enabled: false },
        ])
      } else if (p === 'qwen-anthropic') {
        setModels([
          { id: 'qwen3.7-max', name: 'Qwen3.7 Max', enabled: true },
          { id: 'qwen3.7-plus', name: 'Qwen3.7 Plus', enabled: true },
        ])
      } else if (p === 'qwen-token-plan') {
        setModels([
          { id: 'qwen3.8-max-preview', name: 'Qwen3.8 Max Preview', enabled: true },
          { id: 'qwen3.7-max', name: 'Qwen3.7 Max', enabled: true },
          { id: 'qwen3.7-flash', name: 'Qwen3.7 Flash', enabled: true },
          { id: 'qwen3.6-flash', name: 'Qwen3.6 Flash', enabled: true },
        ])
      }
    }
  }

  /** 添加模型 */
  const handleAddModel = (): void => {
    if (!newModelId.trim()) return

    const model: ChannelModel = {
      id: newModelId.trim(),
      name: newModelName.trim() || newModelId.trim(),
      enabled: true,
      source: 'manual',
    }

    setModels((prev) => [...prev, model])
    setExpandedModelId(model.id)
    setNewModelId('')
    setNewModelName('')

    void window.electronAPI.modelsDevLookup({ provider, baseUrl, modelId: model.id })
      .then((result) => {
        if (!result.info) return
        setModels((prev) => prev.map((current) => (
          current.id === model.id ? applyModelsDevInfo(current, result.info!) : current
        )))
      })
      .catch((error) => console.warn('[模型配置表单] 补全手动模型信息失败:', error))
  }

  /** 删除模型 */
  const handleRemoveModel = (modelId: string): void => {
    setModels((prev) => prev.filter((m) => m.id !== modelId))
  }

  /** 切换模型启用状态（点击可用模型 → 启用，点击已启用模型 → 禁用） */
  const handleToggleModel = (modelId: string): void => {
    setModels((prev) =>
      prev.map((m) => (m.id === modelId ? { ...m, enabled: !m.enabled } : m))
    )
  }

  const handleCancelCodexLogin = (): void => {
    codexLoggingInRef.current = false
    void window.electronAPI.codexOAuthCancel()
    setCodexDeviceCode(null)
  }

  /** 发起 ChatGPT (Codex) OAuth 登录，默认系统浏览器；网络受限时可改用设备码。 */
  const handleCodexLogin = async (method: 'browser' | 'device_code' = 'browser'): Promise<void> => {
    codexLoggingInRef.current = true
    setCodexLoggingIn(true)
    setCodexDeviceCode(null)
    setTestResult(null)
    try {
      const result = await window.electronAPI.codexOAuthLogin(method)
      if (!result.success || !result.credentials) {
        toast.error(result.message ?? 'ChatGPT 登录失败，请重试')
        return
      }
      const credentials = result.credentials
      // 凭据 JSON 已含 accountId，写入 apiKey 后由 codexCredentials 派生展示，无需单独 state。
      setApiKey(credentials)

      // codex 模型是 Pi SDK 内置目录、不依赖凭据/baseUrl。登录后自动拉取并全部启用。
      // 不复用 handleFetchModels：其 gate 读派生自 apiKey state 的 hasRequiredSecret，
      // 而 setApiKey 是异步的，同一 tick 内仍是旧值，这里直接内联拉取。
      let codexModels: ChannelModel[] = []
      try {
        const modelsResult = await window.electronAPI.fetchModels({ provider, baseUrl, apiKey: credentials })
        setFetchResult(modelsResult)
        if (modelsResult.success && modelsResult.models.length > 0) {
          codexModels = modelsResult.models.map((m) => ({ ...m, enabled: true }))
          setModels(codexModels)
        }
      } catch (modelErr) {
        console.error('[模型配置表单] 拉取 ChatGPT 模型失败:', modelErr)
      }

      // OAuth 流程中用户很容易在浏览器授权后直接关闭表单，来不及点「创建」而丢失凭据。
      // 登录成功即明确的保存意图：创建模式下自动落库（编辑模式由 effectiveApiKey 变化触发 auto-save）。
      // 用刚拿到的凭据/模型直接构造入参，避免依赖 setState 后同一 tick 仍是旧值的闭包。
      if (isEdit) {
        toast.success('ChatGPT 登录成功')
      } else {
        const input: ChannelCreateInput = {
          name: name.trim() || PROVIDER_LABELS['openai-codex'],
          provider,
          baseUrl,
          apiKey: credentials,
          models: codexModels,
          enabled,
        }
        const saved = await window.electronAPI.createChannel(input)
        toast.success('ChatGPT 渠道已创建')
        onSaved(saved)
      }
    } catch (error) {
      console.error('[模型配置表单] ChatGPT 登录失败:', error)
      toast.error('ChatGPT 登录失败，请重试')
    } finally {
      codexLoggingInRef.current = false
      setCodexLoggingIn(false)
    }
  }

  const handleCancelGithubCopilotLogin = (): void => {
    githubCopilotLoggingInRef.current = false
    void window.electronAPI.githubCopilotOAuthCancel()
    setGithubCopilotDeviceCode(null)
  }

  /** GitHub Copilot 始终使用 device-code；授权完成后 Pi 返回套餐/策略过滤的模型目录。 */
  const handleGithubCopilotLogin = async (): Promise<void> => {
    githubCopilotLoggingInRef.current = true
    setGithubCopilotLoggingIn(true)
    setGithubCopilotDeviceCode(null)
    setTestResult(null)
    try {
      const result = await window.electronAPI.githubCopilotOAuthLogin(githubCopilotEnterpriseUrl)
      if (!result.success || !result.credentials) {
        toast.error(result.message ?? 'GitHub Copilot 登录失败，请重试')
        return
      }
      const credentials = result.credentials
      setApiKey(credentials)

      let copilotModels: ChannelModel[]
      try {
        const modelsResult = await window.electronAPI.fetchModels({ provider, baseUrl, apiKey: credentials })
        setFetchResult(modelsResult)
        if (!modelsResult.success) {
          toast.error(modelsResult.message ?? '无法读取 GitHub Copilot 可用模型，请重试')
          return
        }
        // 本次登录返回的模型目录反映当前账号与组织策略。空列表也是权威结果，
        // 不得沿用上一个账号的旧模型，否则选择器会显示无法实际调用的选项。
        copilotModels = modelsResult.models.map((model) => ({ ...model, enabled: true }))
        setModels(copilotModels)
      } catch (modelErr) {
        console.error('[模型配置表单] 拉取 GitHub Copilot 模型失败:', modelErr)
        toast.error('无法读取 GitHub Copilot 可用模型，请重试')
        return
      }

      if (isEdit && channel) {
        await window.electronAPI.updateChannel(channel.id, {
          name,
          provider,
          baseUrl,
          apiKey: credentials,
          models: copilotModels,
          enabled,
        })
        toast.success(copilotModels.length > 0 ? 'GitHub Copilot 登录成功' : 'GitHub Copilot 登录成功，但当前订阅没有可用模型')
      } else {
        const input: ChannelCreateInput = {
          name: name.trim() || PROVIDER_LABELS['github-copilot'],
          provider,
          baseUrl,
          apiKey: credentials,
          models: copilotModels,
          enabled,
        }
        const saved = await window.electronAPI.createChannel(input)
        toast.success(copilotModels.length > 0 ? 'GitHub Copilot 渠道已创建' : 'GitHub Copilot 渠道已创建，但当前订阅没有可用模型')
        onSaved(saved)
      }
    } catch (error) {
      console.error('[模型配置表单] GitHub Copilot 登录失败:', error)
      toast.error('GitHub Copilot 登录失败，请重试')
    } finally {
      githubCopilotLoggingInRef.current = false
      setGithubCopilotLoggingIn(false)
      setGithubCopilotDeviceCode(null)
    }
  }

  const handleCancelXaiLogin = (): void => {
    xaiLoggingInRef.current = false
    void window.electronAPI.xaiOAuthCancel()
    setXaiDeviceCode(null)
  }

  /** 发起 xAI（Grok/X 订阅）OAuth 登录：Pi 打开预填 device-code 浏览器授权页。 */
  const handleXaiLogin = async (): Promise<void> => {
    xaiLoggingInRef.current = true
    setXaiLoggingIn(true)
    setXaiDeviceCode(null)
    setTestResult(null)
    try {
      const result = await window.electronAPI.xaiOAuthLogin()
      if (!result.success || !result.credentials) {
        toast.error(result.message ?? 'xAI 登录失败，请重试')
        return
      }
      const credentials = result.credentials
      setApiKey(credentials)

      let xaiModels: ChannelModel[] = []
      try {
        const modelsResult = await window.electronAPI.fetchModels({ provider, baseUrl, apiKey: credentials })
        setFetchResult(modelsResult)
        if (modelsResult.success && modelsResult.models.length > 0) {
          xaiModels = modelsResult.models.map((model) => ({ ...model, enabled: true }))
          setModels(xaiModels)
        }
      } catch (modelErr) {
        console.error('[模型配置表单] 拉取 xAI 模型失败:', modelErr)
      }

      // OAuth 登录成功即明确保存意图。编辑模式也立即写入，不能依赖 600ms 的
      // auto-save，避免用户立刻关闭表单而丢失 refresh token。
      const savedModels = xaiModels.length > 0 ? xaiModels : models
      if (isEdit && channel) {
        const saved = await window.electronAPI.updateChannel(channel.id, {
          name,
          provider,
          baseUrl,
          apiKey: credentials,
          models: savedModels,
          enabled,
        })
        toast.success('xAI 登录成功')
      } else {
        const input: ChannelCreateInput = {
          name: name.trim() || PROVIDER_LABELS.xai,
          provider,
          baseUrl,
          apiKey: credentials,
          models: savedModels,
          enabled,
        }
        const saved = await window.electronAPI.createChannel(input)
        toast.success('xAI 渠道已创建')
        onSaved(saved)
      }
    } catch (error) {
      console.error('[模型配置表单] xAI 登录失败:', error)
      toast.error('xAI 登录失败，请重试')
    } finally {
      xaiLoggingInRef.current = false
      setXaiLoggingIn(false)
      setXaiDeviceCode(null)
    }
  }

  const lookupModelInfo = React.useCallback(async (modelId: string): Promise<ModelsDevModelInfo | null> => {
    try {
      const result = await window.electronAPI.modelsDevLookup({ provider, baseUrl, modelId })
      return result.info
    } catch (error) {
      console.warn('[模型配置表单] 查询 models.dev 模型失败:', error)
      return null
    }
  }, [provider, baseUrl])

  const refreshModelsDev = async (): Promise<void> => {
    setRefreshingModelsDev(true)
    try {
      const status = await window.electronAPI.modelsDevRefresh()
      setModelsDevStatus(status)
      if (status.lastError) toast.error(`模型目录同步失败：${status.lastError}`)
      else toast.success(`模型目录已同步（${status.modelCount} 个模型）`)
    } catch (error) {
      toast.error('模型目录同步失败')
    } finally {
      setRefreshingModelsDev(false)
    }
  }

  /** 从供应商 API 拉取可用模型列表。 */
  const fetchAvailableModels = async (): Promise<void> => {
    // 订阅 provider 走 Pi SDK 内置目录，不依赖 baseUrl；其余 provider 仍要求 baseUrl。
    if (!hasRequiredSecret || (!isSubscriptionProvider && !baseUrl.trim())) return

    setFetchingModels(true)
    setFetchResult(null)

    try {
      const result = await window.electronAPI.fetchModels({
        provider,
        baseUrl,
        apiKey: effectiveApiKey,
      })

      setFetchResult(result)

      // 用成功拉取的结果作为权威清单替换：
      // - source==='manual' 的模型一律保留（即便不在新结果里）
      // - 在新结果里也存在的旧模型保留 enabled 状态
      // - 新出现的模型默认未启用
      // - 既不在新结果里、也不是手动添加的旧模型一律丢弃（清除残留）
      // 拉取失败时保留现有列表，避免 auto-save 持久化空模型列表
      if (!result.success) return
      let fetchedModels = result.models
      try {
        const catalogResult = await window.electronAPI.modelsDevLookupMany(
          fetchedModels.map((model) => ({ provider, baseUrl, modelId: model.id })),
        )
        fetchedModels = fetchedModels.map((model) => {
          const info = catalogResult.infos[model.id]
          return info ? applyModelsDevInfo(model, info) : clearMissingModelsDevInfo(model)
        })
      } catch (error) {
        console.warn('[模型配置表单] 批量补全 models.dev 信息失败:', error)
      }
      const fetchedById = new Map(fetchedModels.map((m) => [m.id, m]))
      setModels((prev) => {
        const manualKept = prev.filter((m) => m.source === 'manual' && !fetchedById.has(m.id))
        const merged = fetchedModels.map((m) => {
          const old = prev.find((p) => p.id === m.id)
          // ChatGPT (Codex) 是 SDK 内置的少量精选模型，拉取即全部启用，
          // 与登录自动拉取路径（handleCodexLogin）保持一致，避免新模型（如 gpt-5.6 系列）
          // 默认未启用而沉到「可用模型」折叠区，被误认为"拉不到"。
          if (!old) return { ...m, enabled: isSubscriptionProvider }
          // 刷新供应商列表不能丢掉用户覆盖或已缓存的目录元数据。
          return {
            ...m,
            enabled: isSubscriptionProvider ? true : old.enabled,
            ...(old.contextWindow !== undefined ? { contextWindow: old.contextWindow } : {}),
            ...(old.contextWindowSource ? { contextWindowSource: old.contextWindowSource } : {}),
            ...(old.maxTokens !== undefined ? { maxTokens: old.maxTokens } : {}),
            ...(old.maxTokensSource ? { maxTokensSource: old.maxTokensSource } : {}),
            ...(old.thinkingLevels ? { thinkingLevels: old.thinkingLevels } : {}),
            ...(old.defaultThinkingLevel !== undefined ? { defaultThinkingLevel: old.defaultThinkingLevel } : {}),
            ...(old.supportsImages !== undefined ? { supportsImages: old.supportsImages } : {}),
            ...(old.supportsDocuments !== undefined ? { supportsDocuments: old.supportsDocuments } : {}),
          }
        })
        return [...manualKept, ...merged]
      })
    } catch (error) {
      setFetchResult({ success: false, message: '拉取模型请求失败', models: [] })
    } finally {
      setFetchingModels(false)
    }
  }

  const handleFetchModels = (): void => {
    void fetchAvailableModels()
  }

  /** 测试连接（直接使用表单当前值，无需先保存）。 */
  const testChannelConnection = async (): Promise<void> => {
    if (!hasRequiredSecret || !baseUrl.trim() || isSubscriptionProvider) return

    setTesting(true)
    setTestResult(null)

    try {
      const modelId = resolveDirectTestModelId(provider, models)
      const result = await window.electronAPI.testChannelDirect({
        provider,
        baseUrl,
        apiKey: effectiveApiKey,
        ...(modelId ? { modelId } : {}),
      })
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: '测试请求失败' })
    } finally {
      setTesting(false)
    }
  }

  const handleTest = (): void => {
    void testChannelConnection()
  }

  /** 执行创建渠道 */
  const doCreate = React.useCallback(async (): Promise<Channel | null> => {
    if (!name.trim() || !hasRequiredSecret) return null

    setSaving(true)
    try {
      const input: ChannelCreateInput = {
        name,
        provider,
        baseUrl,
        apiKey: effectiveApiKey,
        models,
        enabled,
      }
      const savedChannel = await window.electronAPI.createChannel(input)
      toast.success('渠道创建成功')
      return savedChannel
    } catch (error) {
      console.error('[模型配置表单] 创建失败:', error)
      toast.error('渠道创建失败，请检查配置后重试')
      return null
    } finally {
      setSaving(false)
    }
  }, [name, provider, baseUrl, effectiveApiKey, hasRequiredSecret, models, enabled])

  /** 创建渠道（仅新建模式） */
  const handleCreate = async (): Promise<void> => {
    if (models.length === 0) {
      toast.warning('尚未配置模型，建议先从供应商获取或手动添加', { id: 'no-models-warn' })
      return
    }
    const savedChannel = await doCreate()
    if (savedChannel) onSaved(savedChannel)
  }

  /** 检测表单是否有未保存内容 */
  const isDirty = !isEdit && (name.trim() !== '' || effectiveApiKey.trim() !== '' || models.length > 0)
  const hasNoModels = !isEdit && models.length === 0

  /**
   * 编辑模式下若当前 provider 已从新建下拉移除（如旧版 'qwen'），
   * 动态追加对应选项，避免 SettingsSelect 因找不到 value 而显示占位符。
   */
  const providerSelectOptions = React.useMemo(() => {
    if (isEdit && !PROVIDER_OPTIONS.includes(provider)) {
      return [
        ...PROVIDER_SELECT_OPTIONS,
        { value: provider, label: PROVIDER_LABELS[provider], icon: getProviderLogo(provider) },
      ]
    }
    return PROVIDER_SELECT_OPTIONS
  }, [isEdit, provider])

  /** 返回按钮：创建模式下有未保存内容时拦截 */
  const handleBack = (): void => {
    if (!isEdit && isDirty) {
      setShowExitDialog(true)
      return
    }
    if (isEdit) {
      onSaved()
    } else {
      onCancel()
    }
  }

  /** 放弃编辑 */
  const handleDiscard = (): void => {
    setShowExitDialog(false)
    onCancel()
  }

  /** 保存并关闭（从弹窗触发） */
  const handleSaveAndClose = async (): Promise<void> => {
    const savedChannel = await doCreate()
    if (savedChannel) {
      setShowExitDialog(false)
      onSaved(savedChannel)
    }
  }

  // 同步表单 dirty 状态到全局 atom（供 SettingsPanel 拦截侧边栏导航）
  React.useEffect(() => {
    setChannelFormDirty(isDirty)
    return () => { setChannelFormDirty(false) }
  }, [isDirty, setChannelFormDirty])

  // 拦截窗口关闭（Cmd+W / Alt+F4 / 点击窗口 X）
  React.useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // ===== 模型分区 =====
  const enabledModels = models.filter((m) => m.enabled)
  const availableModels = React.useMemo(() => {
    const disabled = models.filter((m) => !m.enabled)
    if (!modelFilter.trim()) return disabled
    const keyword = modelFilter.trim().toLowerCase()
    return disabled.filter(
      (m) => m.id.toLowerCase().includes(keyword) || m.name.toLowerCase().includes(keyword)
    )
  }, [models, modelFilter])

  return (
    <div className="space-y-6">
      {/* 标题栏 */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={handleBack}
        >
          <ArrowLeft size={18} />
        </Button>
        <h3 className="text-lg font-medium text-foreground flex-1">
          {isEdit ? '编辑模型配置' : '添加模型配置'}
        </h3>
        {/* 新建模式：创建按钮 */}
        {!isEdit && (
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={saving || !name.trim() || !hasRequiredSecret}
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            <span>创建</span>
          </Button>
        )}
      </div>

      {/* 基本信息卡片 */}
      <SettingsSection title="基本信息">
        <SettingsCard>
          <SettingsSelect
            label="供应商类型"
            value={provider}
            onValueChange={handleProviderChange}
            options={providerSelectOptions}
            placeholder="选择供应商"
          />
          {provider === 'custom' && (
            <div className="px-4 pb-3 text-xs text-muted-foreground">
              用于 OpenAI Chat Completions 的自定义请求地址，Chat 会按原样发送请求。用于 Agent 时请选择 Pi；若服务提供 Anthropic Messages 端点，请选择「Anthropic 兼容格式」。
            </div>
          )}
          <SettingsInput
            label="供应商名称"
            value={name}
            onChange={setName}
            placeholder="例如: My Anthropic"
            required
          />
          {/* 订阅 provider 的请求地址由 Pi SDK 内置管理，无需用户填写 */}
          {!isSubscriptionProvider && (
            <SettingsInput
              label={getUrlInputLabel(provider)}
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder={getUrlInputPlaceholder(provider)}
              description={baseUrl.trim() ? `预览：${buildPreviewUrl(baseUrl, provider)}` : undefined}
            />
          )}
          {/* API Key + 测试连接同行 */}
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-foreground">
                {isCodexProvider ? 'ChatGPT 登录' : isGithubCopilotProvider ? 'GitHub Copilot 登录' : isXaiProvider ? 'xAI 登录' : isZhipuTeamProvider ? '智谱团队版凭证' : 'API Key'}
              </div>
              {/* 订阅 OAuth 无标准 API Key 测试路径，隐藏测试按钮 */}
              {!isSubscriptionProvider && (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={handleTest}
                  disabled={testing || !hasRequiredSecret || !baseUrl.trim()}
                  className="h-7 text-xs"
                >
                  {testing ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Zap size={12} />
                  )}
                  <span>测试连接</span>
                </Button>
              )}
            </div>
            {isCodexProvider ? (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => void handleCodexLogin('browser')}
                  disabled={codexLoggingIn}
                  className="w-full"
                >
                  {codexLoggingIn ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  <span>{codexLoggingIn ? '等待授权完成…' : hasRequiredSecret ? '重新登录 ChatGPT' : '用 ChatGPT 登录'}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => void handleCodexLogin('device_code')}
                  disabled={codexLoggingIn}
                  className="w-full text-muted-foreground"
                >
                  使用设备码登录（浏览器无法使用系统代理时）
                </Button>
                {codexLoggingIn && (
                  <Button variant="ghost" size="sm" type="button" onClick={handleCancelCodexLogin} className="w-full text-muted-foreground">
                    取消登录
                  </Button>
                )}
                {codexDeviceCode && (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-2">
                    <div>在任意可访问网络的浏览器中打开链接，并输入设备码：<span className="font-mono font-medium text-foreground">{codexDeviceCode.userCode}</span></div>
                    <a href={codexDeviceCode.verificationUri} target="_blank" rel="noreferrer" className="text-primary hover:underline">打开 ChatGPT 授权页面</a>
                    {codexDeviceCode.qrCodeData && <img src={codexDeviceCode.qrCodeData} alt="ChatGPT 设备码授权二维码" className="h-28 w-28 rounded bg-white p-1" />}
                  </div>
                )}
                {hasRequiredSecret ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 size={12} className="shrink-0" />
                    <span>已登录 ChatGPT 订阅{codexCredentials?.accountId ? `（账号 ${codexCredentials.accountId.slice(0, 8)}…）` : ''}</span>
                  </div>
                ) : <div className="text-xs text-muted-foreground">Proma 会代理 token 请求；系统浏览器授权页仍需使用可访问 OpenAI 的网络。可改用设备码并在另一台设备完成授权。</div>}
              </div>
            ) : isGithubCopilotProvider ? (
              <div className="space-y-2">
                <Input
                  value={githubCopilotEnterpriseUrl}
                  onChange={(event) => setGithubCopilotEnterpriseUrl(event.target.value)}
                  placeholder="GitHub Enterprise Server 域名（可选，例如 github.company.com）"
                  disabled={githubCopilotLoggingIn}
                />
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={handleGithubCopilotLogin}
                  disabled={githubCopilotLoggingIn}
                  className="w-full"
                >
                  {githubCopilotLoggingIn ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  <span>{githubCopilotLoggingIn ? '等待 GitHub 授权完成…' : hasRequiredSecret ? '重新登录 GitHub Copilot' : '用 GitHub Copilot 登录'}</span>
                </Button>
                {githubCopilotLoggingIn && (
                  <Button variant="ghost" size="sm" type="button" onClick={handleCancelGithubCopilotLogin} className="w-full text-muted-foreground">
                    取消登录
                  </Button>
                )}
                {githubCopilotDeviceCode && (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-2">
                    <div>在 GitHub 授权页面输入设备码：<span className="font-mono font-medium text-foreground">{githubCopilotDeviceCode.userCode}</span></div>
                    <a href={githubCopilotDeviceCode.verificationUri} target="_blank" rel="noreferrer" className="text-primary hover:underline">打开 GitHub 授权页面</a>
                    {githubCopilotDeviceCode.qrCodeData && <img src={githubCopilotDeviceCode.qrCodeData} alt="GitHub Copilot 设备码授权二维码" className="h-28 w-28 rounded bg-white p-1" />}
                  </div>
                )}
                {hasRequiredSecret ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 size={12} className="shrink-0" />
                    <span>已登录 GitHub Copilot 订阅（{githubCopilotCredentials?.availableModelIds.length ?? 0} 个可用模型）</span>
                  </div>
                ) : <div className="text-xs text-muted-foreground">Proma 会通过 GitHub device-code 绑定 Copilot 订阅，并按你的套餐和组织策略只显示可用模型。</div>}
              </div>
            ) : isXaiProvider ? (
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={handleXaiLogin}
                  disabled={xaiLoggingIn}
                  className="w-full"
                >
                  {xaiLoggingIn ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  <span>{xaiLoggingIn ? '等待浏览器授权…' : hasRequiredSecret ? '重新登录 xAI' : '用 xAI 登录'}</span>
                </Button>
                {xaiLoggingIn && (
                  <Button variant="ghost" size="sm" type="button" onClick={handleCancelXaiLogin} className="w-full text-muted-foreground">
                    取消登录
                  </Button>
                )}
                {xaiDeviceCode && (
                  <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-2">
                    <div>若浏览器未自动填入授权码，请输入：<span className="font-mono font-medium text-foreground">{xaiDeviceCode.userCode}</span></div>
                    <a href={xaiDeviceCode.verificationUri} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      打开 xAI 授权页面
                    </a>
                    {xaiDeviceCode.qrCodeData && <img src={xaiDeviceCode.qrCodeData} alt="xAI 设备码授权二维码" className="h-28 w-28 rounded bg-white p-1" />}
                  </div>
                )}
                {hasRequiredSecret ? (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                    <CheckCircle2 size={12} className="shrink-0" />
                    <span>已登录 xAI（Grok）订阅</span>
                  </div>
                ) : <div className="text-xs text-muted-foreground">Proma 会代理设备码与 token 请求；授权页由系统浏览器打开。若浏览器无可用代理，可扫码在另一台设备完成授权。</div>}
              </div>
            ) : isZhipuTeamProvider ? (
              <div className="space-y-2">
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={zhipuTeamSecret.apiKey}
                    onChange={(e) => updateZhipuTeamSecret({ apiKey: e.target.value })}
                    placeholder="API Token"
                    required={!isEdit}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                    title={showApiKey ? '隐藏凭证' : '显示凭证'}
                  >
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={zhipuTeamSecret.organization}
                    onChange={(e) => updateZhipuTeamSecret({ organization: e.target.value })}
                    placeholder="组织 ID（可选）"
                  />
                  <Input
                    value={zhipuTeamSecret.project}
                    onChange={(e) => updateZhipuTeamSecret({ project: e.target.value })}
                    placeholder="项目 ID（可选）"
                  />
                </div>
                <div className="text-xs text-muted-foreground">
                  组织 ID 和项目 ID 可在{' '}
                  <a
                    href="https://bigmodel.cn/usercenter/proj-mgmt/org-mgmt"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    智谱组织与项目管理
                  </a>
                  {' '}查看；不填写时使用 API Token 的默认组织与项目上下文查询。
                </div>
              </div>
            ) : (
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={getApiKeyPlaceholder(provider, isEdit)}
                  required={!isEdit}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            )}
            {testResult && (
              <div className={cn(
                'flex items-start gap-1.5 text-xs',
                testResult.success ? 'text-emerald-600' : 'text-destructive'
              )}>
                {testResult.success
                  ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
                  : <XCircle size={12} className="mt-0.5 shrink-0" />}
                <span className="min-w-0 break-all">{testResult.message}</span>
              </div>
            )}
          </div>
          <SettingsToggle
            label="启用此配置"
            description="关闭后该配置的模型不会在选择列表中出现"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </SettingsCard>
      </SettingsSection>

      {/* 已启用模型 */}
      <SettingsSection
        title="已启用模型"
        description={enabledModels.length > 0 ? `${enabledModels.length} 个模型` : undefined}
      >
        <SettingsCard divided={false}>
          {enabledModels.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              还没有启用任何模型，从下方可用模型中选择
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {enabledModels.map((model) => (
                <div key={model.id} className="px-4 py-2.5 group">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                    <span className="min-w-0 flex-1 text-sm text-foreground">
                      <span className="block truncate">{model.name}</span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">
                        {model.id} · 上下文 {formatTokenCount(model.contextWindow)} · 输出 {formatTokenCount(model.maxTokens)}
                        {!model.contextWindow && !model.maxTokens ? ' · 未找到目录信息' : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedModelId((current) => current === model.id ? null : model.id)}
                      className="flex items-center gap-1 px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                      aria-expanded={expandedModelId === model.id}
                    >
                      高级
                      <ChevronDown size={13} className={cn('transition-transform', expandedModelId === model.id && 'rotate-180')} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleModel(model.id)}
                      className="p-0.5 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                      title="取消启用"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  {expandedModelId === model.id && (
                    <div className="mt-3 space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium text-muted-foreground">上下文长度</div>
                          <div className="flex flex-wrap gap-1">
                            {CONTEXT_WINDOW_PRESETS.map((preset) => (
                              <Button
                                key={preset}
                                variant={model.contextWindow === preset ? 'secondary' : 'ghost'}
                                size="sm"
                                type="button"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => setModels((prev) => prev.map((item) => item.id === model.id
                                  ? { ...item, contextWindow: preset, contextWindowSource: 'user' }
                                  : item))}
                              >
                                {formatTokenCount(preset)}
                              </Button>
                            ))}
                          </div>
                          <Input
                            type="number"
                            min={1}
                            value={model.contextWindow ?? ''}
                            onChange={(event) => setModels((prev) => prev.map((item) => item.id === model.id
                              ? { ...item, contextWindow: Number(event.target.value) || undefined, contextWindowSource: 'user' }
                              : item))}
                            className="h-8 text-xs"
                            placeholder="跟随 models.dev"
                          />
                          <div className="text-[11px] text-muted-foreground">
                            {model.contextWindowSource === 'user' ? '已手动覆盖' : '使用目录默认'}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium text-muted-foreground">最大输出</div>
                          <div className="flex flex-wrap gap-1">
                            {MAX_OUTPUT_PRESETS.map((preset) => (
                              <Button
                                key={preset}
                                variant={model.maxTokens === preset ? 'secondary' : 'ghost'}
                                size="sm"
                                type="button"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => setModels((prev) => prev.map((item) => item.id === model.id
                                  ? { ...item, maxTokens: preset, maxTokensSource: 'user' }
                                  : item))}
                              >
                                {formatTokenCount(preset)}
                              </Button>
                            ))}
                          </div>
                          <Input
                            type="number"
                            min={1}
                            value={model.maxTokens ?? ''}
                            onChange={(event) => setModels((prev) => prev.map((item) => item.id === model.id
                              ? { ...item, maxTokens: Number(event.target.value) || undefined, maxTokensSource: 'user' }
                              : item))}
                            className="h-8 text-xs"
                            placeholder="跟随 models.dev"
                          />
                          <div className="text-[11px] text-muted-foreground">
                            {model.maxTokensSource === 'user' ? '已手动覆盖' : '使用目录默认'}
                          </div>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-xs font-medium text-muted-foreground">思考等级</div>
                        <div className="flex flex-wrap gap-1">
                          {THINKING_LEVEL_OPTIONS.map((level) => {
                            const selected = (model.thinkingLevels ?? []).includes(level)
                            return (
                              <Button
                                key={level}
                                variant={selected ? 'secondary' : 'ghost'}
                                size="sm"
                                type="button"
                                className="h-6 px-2 text-[11px]"
                                onClick={() => setModels((prev) => prev.map((item) => {
                                  if (item.id !== model.id) return item
                                  const levels = item.thinkingLevels ?? []
                                  const nextLevels = selected
                                    ? levels.filter((entry) => entry !== level)
                                    : [...levels, level]
                                  const nextDefault = nextLevels.includes(item.defaultThinkingLevel ?? 'off')
                                    ? item.defaultThinkingLevel
                                    : (nextLevels[0] ?? 'off')
                                  return { ...item, thinkingLevels: nextLevels, defaultThinkingLevel: nextDefault }
                                }))}
                              >
                                {level}
                              </Button>
                            )
                          })}
                        </div>
                        <select
                          value={model.defaultThinkingLevel ?? 'off'}
                          onChange={(event) => setModels((prev) => prev.map((item) => item.id === model.id
                            ? { ...item, defaultThinkingLevel: event.target.value as ChannelModel['defaultThinkingLevel'] }
                            : item))}
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                        >
                          {THINKING_LEVEL_OPTIONS
                            .filter((level) => (model.thinkingLevels ?? []).includes(level))
                            .map((level) => <option key={level} value={level}>{`默认：${level}`}</option>)}
                        </select>
                      </div>

                      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={model.supportsImages === true}
                            onChange={(event) => setModels((prev) => prev.map((item) => item.id === model.id
                              ? { ...item, supportsImages: event.target.checked }
                              : item))}
                          />
                          图像输入
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input
                            type="checkbox"
                            checked={model.supportsDocuments === true}
                            onChange={(event) => setModels((prev) => prev.map((item) => item.id === model.id
                              ? { ...item, supportsDocuments: event.target.checked }
                              : item))}
                          />
                          文档输入
                        </label>
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => void lookupModelInfo(model.id).then((info) => {
                            if (!info) return
                            setModels((prev) => prev.map((item) => {
                              if (item.id !== model.id) return item
                              return applyModelsDevInfo({
                                ...item,
                                contextWindow: undefined,
                                contextWindowSource: undefined,
                                maxTokens: undefined,
                                maxTokensSource: undefined,
                                thinkingLevels: undefined,
                                defaultThinkingLevel: undefined,
                                supportsImages: undefined,
                                supportsDocuments: undefined,
                              }, info)
                            }))
                          })}
                        >
                          恢复目录默认
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </SettingsCard>
      </SettingsSection>

      {/* 可用模型 */}
      <SettingsSection
        title="可用模型"
        action={
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => void refreshModelsDev()}
              disabled={refreshingModelsDev}
              className="h-7 px-2 text-xs"
              title={modelsDevStatus ? `目录 ${modelsDevStatus.modelCount} 个模型` : '同步 models.dev'}
            >
              <RefreshCw size={12} className={cn(refreshingModelsDev && 'animate-spin')} />
              <span>同步目录</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={handleFetchModels}
              disabled={fetchingModels || !hasRequiredSecret || (!isSubscriptionProvider && !baseUrl.trim())}
              className="h-7 text-xs"
            >
              {fetchingModels ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              <span>从供应商获取</span>
            </Button>
          </div>
        }
      >
        {modelsDevStatus && (
          <div className="px-1 text-[11px] text-muted-foreground">
            默认信息来源：models.dev · {modelsDevStatus.modelCount} 个模型
            {modelsDevStatus.lastError
              ? ` · 同步失败，继续使用本地目录（${modelsDevStatus.lastError}）`
              : ''}
          </div>
        )}
        {/* 拉取结果提示 */}
        {fetchResult && (
          <div className={cn(
            'flex items-center gap-1.5 text-xs px-1',
            fetchResult.success ? 'text-emerald-600' : 'text-destructive'
          )}>
            {fetchResult.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            <span>{fetchResult.message}</span>
          </div>
        )}

        <SettingsCard divided={false}>
          {/* 模型搜索过滤 */}
          {models.filter((m) => !m.enabled).length > 5 && (
            <div className="px-4 pt-3 pb-1">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={modelFilter}
                  onChange={(e) => setModelFilter(e.target.value)}
                  placeholder="搜索可用模型..."
                  className="h-8 text-sm pl-8"
                />
              </div>
            </div>
          )}

          {/* 可用模型计数 */}
          {models.filter((m) => !m.enabled).length > 0 && (
            <div className="px-4 pt-2 pb-1 text-xs text-muted-foreground">
              {modelFilter.trim()
                ? `${availableModels.length} / ${models.filter((m) => !m.enabled).length} 个可用模型`
                : `${models.filter((m) => !m.enabled).length} 个可用模型`}
            </div>
          )}

          <ScrollArea className={availableModels.length > 8 ? 'h-[280px]' : undefined}>
            <div className="divide-y divide-border/50">
              {availableModels.map((model) => (
                <div
                  key={model.id}
                  className="flex items-center gap-2 px-4 py-2.5 group cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => handleToggleModel(model.id)}
                >
                  <Plus size={14} className="text-muted-foreground flex-shrink-0" />
                  <span className="min-w-0 flex-1 text-sm text-foreground">
                    <span className="block truncate">{model.name}</span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {model.id} · 上下文 {formatTokenCount(model.contextWindow)} · 输出 {formatTokenCount(model.maxTokens)}
                      {!model.contextWindow && !model.maxTokens ? ' · 未找到目录信息' : ''}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveModel(model.id) }}
                    className="p-0.5 text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
                    title="删除"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}

              {/* 搜索无结果提示 */}
              {modelFilter.trim() && availableModels.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  未找到匹配的模型
                </div>
              )}

              {/* 无可用模型提示 */}
              {!modelFilter.trim() && models.filter((m) => !m.enabled).length === 0 && models.length > 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  所有模型已启用
                </div>
              )}
            </div>
          </ScrollArea>

          {/* 手动添加模型 */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border/50">
            <Input
              value={newModelId}
              onChange={(e) => setNewModelId(e.target.value)}
              placeholder="模型 ID（如 claude-opus-4-6）"
              className="flex-1 h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddModel()
                }
              }}
            />
            <Input
              value={newModelName}
              onChange={(e) => setNewModelName(e.target.value)}
              placeholder="显示名称（可选）"
              className="flex-1 h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddModel()
                }
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              type="button"
              onClick={handleAddModel}
              disabled={!newModelId.trim()}
              className="h-8 w-8 flex-shrink-0"
            >
              <Plus size={18} />
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* 退出拦截弹窗 */}
      <AlertDialog open={showExitDialog} onOpenChange={setShowExitDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>
              {hasNoModels
                ? '当前尚未配置模型，建议先配置模型再保存。'
                : '您填写的内容尚未保存，确定要放弃编辑吗？'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleDiscard}>放弃编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSaveAndClose}
              disabled={saving || !name.trim() || !hasRequiredSecret}
            >
              {saving ? <><Loader2 size={14} className="animate-spin" /> 保存中...</> : '保存并关闭'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
