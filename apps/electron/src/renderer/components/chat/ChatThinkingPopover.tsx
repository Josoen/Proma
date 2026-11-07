import * as React from 'react'
import { Brain } from 'lucide-react'
import { getGeminiModelCapability, sortThinkingLevels, type AgentThinkingLevel } from '@proma/shared'
import { useAtomValue } from 'jotai'
import { channelsAtom } from '@/atoms/chat-atoms'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { inputToolbarActiveButtonClass, inputToolbarButtonClass } from '@/components/ai-elements/input-toolbar-styles'
import { useConversationThinkingEnabled, useConversationThinkingLevel } from '@/hooks/useConversationSettings'
import { cn } from '@/lib/utils'

const THINKING_LEVEL_LABELS: Record<AgentThinkingLevel, string> = {
  off: '关闭',
  minimal: '最小',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
  max: '最大',
}

interface ChatThinkingPopoverProps {
  modelId?: string
  channelId?: string
}

/**
 * Chat 的思考设置。仅 Gemini 3 文本模型显示其官方支持的深度；其他模型仍保留原有开关。
 * 设置只写入当前对话 atom，不订阅流式内容或增加 IPC。
 */
export function ChatThinkingPopover({ modelId, channelId }: ChatThinkingPopoverProps): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const [thinkingEnabled, setThinkingEnabled] = useConversationThinkingEnabled()
  const [thinkingLevel, setThinkingLevel] = useConversationThinkingLevel()
  const channels = useAtomValue(channelsAtom)
  const capability = getGeminiModelCapability(modelId)
  const channel = channels.find((item) => item.id === channelId)
  const configuredModel = channel?.models.find((model) => model.id === modelId)
  const [catalogLevels, setCatalogLevels] = React.useState<AgentThinkingLevel[] | null>(null)

  React.useEffect(() => {
    setCatalogLevels(null)
    if (!modelId || !channelId || configuredModel?.thinkingLevels?.length) return
    if (!channel) return
    void window.electronAPI.modelsDevLookup({
      provider: channel.provider,
      baseUrl: channel.baseUrl,
      modelId,
    }).then((result) => {
      if (result.info?.thinkingLevels) setCatalogLevels(result.info.thinkingLevels)
    }).catch(() => undefined)
  }, [channel?.baseUrl, channel?.provider, channelId, configuredModel?.thinkingLevels, modelId])

  const thinkingLevels: AgentThinkingLevel[] = configuredModel?.thinkingLevels?.length
    ? sortThinkingLevels(configuredModel.thinkingLevels)
    : catalogLevels ?? (capability ? [...capability.thinkingLevels] : ['off'])
  const defaultLevel = configuredModel?.defaultThinkingLevel
    ?? capability?.defaultThinkingLevel
    ?? (thinkingLevels.includes('medium') ? 'medium' : (thinkingLevels.find((level) => level !== 'off') ?? 'off'))
  const effectiveLevel = thinkingLevels.includes(thinkingLevel) ? thinkingLevel : defaultLevel

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(inputToolbarButtonClass, thinkingEnabled && inputToolbarActiveButtonClass)}
          aria-label="思考设置"
        >
          <Brain className="size-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="center" sideOffset={8} className="w-56 space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">思考模式</p>
            <p className="text-xs text-muted-foreground">{thinkingEnabled ? '已启用' : '已关闭'}</p>
          </div>
          <Switch checked={thinkingEnabled} onCheckedChange={setThinkingEnabled} aria-label="启用思考模式" />
        </div>
        {thinkingLevels.length > 1 && (
          <div className="space-y-2 border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">思考等级</p>
            <div className="grid grid-cols-2 gap-1">
              {thinkingLevels.map((level) => (
                <Button
                  key={level}
                  type="button"
                  variant={effectiveLevel === level ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 justify-start px-2 text-xs"
                  disabled={!thinkingEnabled}
                  onClick={() => setThinkingLevel(level)}
                >
                  {THINKING_LEVEL_LABELS[level]}
                </Button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              当前模型默认：{THINKING_LEVEL_LABELS[defaultLevel]}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
