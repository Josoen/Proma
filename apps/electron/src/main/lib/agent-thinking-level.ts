import { inferReasoningTransport, normalizeReasoningCapabilityLevel, normalizeReasoningLevel, resolveReasoningProfile, type AgentSessionMeta, type AgentThinkingLevel, type ProviderType, type ReasoningCapability } from '@proma/shared'
import type { AppSettings } from '../../types'
import type { ChannelModel } from '@proma/shared'

type ThinkingSettings = Pick<AppSettings, 'agentThinking' | 'agentEffort'>
type ThinkingSessionMeta = Pick<AgentSessionMeta, 'reasoningLevel' | 'openAIThinkingLevel'>

export function resolvePiThinkingLevel(
  settings: ThinkingSettings,
  sessionMeta: ThinkingSessionMeta | undefined,
  provider: ProviderType | undefined,
  modelId?: string,
  capability?: ReasoningCapability,
  modelConfig?: Pick<ChannelModel, 'defaultThinkingLevel' | 'thinkingLevels'>,
): AgentThinkingLevel {
  const reasoningProfile = resolveReasoningProfile({
    modelId,
    transport: inferReasoningTransport(provider),
  })
  if (reasoningProfile) {
    const persistedLevel = sessionMeta?.reasoningLevel ?? sessionMeta?.openAIThinkingLevel
    const configuredLevel = settings.agentThinking?.type === 'disabled' ? 'off' : settings.agentEffort
    return normalizeReasoningLevel(reasoningProfile, persistedLevel ?? modelConfig?.defaultThinkingLevel ?? configuredLevel)!
  }
  const configuredLevel = settings.agentThinking?.type === 'disabled' ? 'off' : settings.agentEffort
  if (capability) {
    const persistedLevel = sessionMeta?.reasoningLevel ?? sessionMeta?.openAIThinkingLevel
    return normalizeReasoningCapabilityLevel(capability, persistedLevel ?? modelConfig?.defaultThinkingLevel ?? configuredLevel)!
  }
  if (settings.agentThinking?.type === 'disabled') return 'off'
  if (settings.agentEffort === 'max') return 'xhigh'
  // 无持久化配置的旧用户也采用新的默认值；显式 disabled 仍优先关闭。
  return modelConfig?.defaultThinkingLevel ?? settings.agentEffort ?? 'high'
}
