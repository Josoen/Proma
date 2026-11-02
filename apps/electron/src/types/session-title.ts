import { getGeminiModelCapability, inferReasoningTransport, resolveReasoningProfile } from '@proma/shared'
import type { Channel } from '@proma/shared'

export interface SessionTitleSettings {
  /** 缺省时跟随当前 Agent 会话模型。 */
  model?: {
    channelId: string
    modelId: string
  }
}

/** 保存时仅接受完整模型引用，不接受 Prompt 或思考等级配置。 */
export function validateSessionTitleSettings(input: unknown): SessionTitleSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('标题模型配置无效')
  }
  const model = (input as { model?: unknown }).model
  if (model === undefined) return {}
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new Error('请选择完整的标题渠道和模型')
  }
  const { channelId, modelId } = model as { channelId?: unknown; modelId?: unknown }
  if (typeof channelId !== 'string' || !channelId.trim() || typeof modelId !== 'string' || !modelId.trim()) {
    throw new Error('请选择完整的标题渠道和模型')
  }
  return { model: { channelId: channelId.trim(), modelId: modelId.trim() } }
}

/** UI 与主进程共用已知能力校验；Pi runtime 会进一步核对实际模型目录。 */
export function getSessionTitleModelError(channel: Channel | undefined, modelId: string): string | null {
  if (!channel?.enabled || channel.provider === 'opencode-go-openai') {
    return '标题渠道不可用，请重新选择'
  }
  const id = modelId.replace(/\[1m\]$/i, '')
  const model = channel.models.find((item) => item.id.replace(/\[1m\]$/i, '') === id)
  if (!model?.enabled) return '标题模型不可用，请重新选择'
  const profile = resolveReasoningProfile({ modelId: id, transport: inferReasoningTransport(channel.provider) })
    ?? (channel.provider === 'github-copilot'
      ? resolveReasoningProfile({ modelId: id, transport: 'openai-responses' })
      : undefined)
  if ((profile && !profile.levels.includes('off'))
    || (model.thinkingLevels?.length && !model.thinkingLevels.includes('off'))
    || getGeminiModelCapability(id)) {
    return '该模型不支持关闭思考，请选择支持 off 的标题模型'
  }
  return null
}
