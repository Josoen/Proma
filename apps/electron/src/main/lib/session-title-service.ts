import type { AgentGenerateTitleInput, Channel } from '@proma/shared'
import type { SessionTitleSettings } from '../../types/session-title'
import { getSessionTitleModelError, validateSessionTitleSettings } from '../../types/session-title'
import { createFallbackTitle, sanitizeGeneratedTitle, TITLE_PROMPT } from './title-generation'

export interface SessionTitleDependencies {
  getChannel: (channelId: string) => Channel | undefined
  complete: (channel: Channel, modelId: string, prompt: string, signal?: AbortSignal) => Promise<string | null>
}

/** 只生成文本；资格判断、会话持久化与标题事件仍由编排层负责。 */
export async function generateSessionTitle(
  input: AgentGenerateTitleInput,
  settings: SessionTitleSettings | undefined,
  dependencies: SessionTitleDependencies,
  signal?: AbortSignal,
): Promise<string | null> {
  if (signal?.aborted || !input.userMessage.trim()) return null
  let channelId = input.channelId
  let modelId = input.modelId
  let phase = '配置校验'
  let reason = '模型引用无效'
  try {
    const configured = settings === undefined ? undefined : validateSessionTitleSettings(settings).model
    channelId = configured?.channelId ?? channelId
    modelId = configured?.modelId ?? modelId
    const channel = dependencies.getChannel(channelId)
    const error = getSessionTitleModelError(channel, modelId)
    if (error || !channel) {
      reason = error ?? '标题渠道不存在'
      throw new Error(reason)
    }
    phase = '模型请求'
    reason = '请求未完成'
    const title = sanitizeGeneratedTitle(await dependencies.complete(
      channel, modelId, TITLE_PROMPT + input.userMessage.slice(0, 4_000), signal,
    ))
    if (signal?.aborted) return null
    if (title) return title
    console.warn('[Agent 标题生成] 返回空标题:', { channelId, modelId })
  } catch (error) {
    if (signal?.aborted) return null
    // 不输出供应商异常正文，避免回显 Prompt 或认证请求内容。
    console.warn('[Agent 标题生成] 配置或模型请求失败:', {
      channelId, modelId, phase, reason, errorType: error instanceof Error ? error.name : 'unknown',
    })
  }
  return createFallbackTitle(input.userMessage)
}
