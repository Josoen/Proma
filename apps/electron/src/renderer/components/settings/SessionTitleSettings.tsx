import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { channelsAtom } from '@/atoms/chat-atoms'
import { sessionTitleSettingsAtom } from '@/atoms/session-title-settings'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { Button } from '@/components/ui/button'
import type { SessionTitleSettings as TitleSettings } from '@/types/settings'
import { getSessionTitleModelError, validateSessionTitleSettings } from '@/types/session-title'
import { SettingsCard, SettingsRow, SettingsSection } from './primitives'

export function SessionTitleSettings(): React.ReactElement {
  const [saved, setSaved] = useAtom(sessionTitleSettingsAtom)
  const channels = useAtomValue(channelsAtom)
  const [draft, setDraft] = React.useState<TitleSettings>({})
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const [notice, setNotice] = React.useState('')

  React.useEffect(() => {
    let active = true
    window.electronAPI.getSettings().then((settings) => {
      if (!active) return
      const value = validateSessionTitleSettings(settings.sessionTitle ?? {})
      setSaved(value)
      setDraft(value)
    }).catch(() => {
      if (active) setError('标题模型配置读取失败，请重新打开设置后重试')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [setSaved])

  const model = draft.model
  const modelError = model ? getSessionTitleModelError(channels.find((channel) => channel.id === model.channelId), model.modelId) : null
  const changed = model?.channelId !== saved.model?.channelId || model?.modelId !== saved.model?.modelId

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const result = await window.electronAPI.updateSettings({ sessionTitle: draft })
      const value = validateSessionTitleSettings(result.sessionTitle ?? {})
      setSaved(value)
      setDraft(value)
      setNotice('标题模型配置已保存')
    } catch {
      setError('保存失败，当前选择尚未生效，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSection title="Agent 会话标题" description="单独选择用于生成 Agent 标题的模型，不影响主对话。普通 Chat 标题不受此配置影响。">
      <fieldset disabled={loading || saving} className="min-w-0 space-y-3" aria-busy={loading || saving}>
        <SettingsCard>
          <SettingsRow label="标题模型" description={model
            ? `独立模型：${channels.find((channel) => channel.id === model.channelId)?.name ?? model.channelId} · ${model.modelId}`
            : '跟随当前会话模型；也可选择下方已有渠道中的独立模型。'}>
            <ModelSelector
              externalSelectedModel={model ?? null}
              showChannelInTrigger
              onModelSelect={(option) => {
                if (loading || saving) return
                setDraft({ model: { channelId: option.channelId, modelId: option.modelId } })
                setNotice('')
              }}
            />
          </SettingsRow>
          <SettingsRow label="思考等级" description="固定关闭思考，不继承会话思考设置；标题 Prompt 内置于代码。">
            <span className="text-sm text-muted-foreground">off（关闭）</span>
          </SettingsRow>
        </SettingsCard>
        <p className="text-xs leading-relaxed text-muted-foreground">
          会将首条用户消息的前 4,000 字符发送给所选标题模型；失败时使用首行作为标题。
          {!channels.some((channel) => channel.enabled && channel.models.some((item) => item.enabled)) && ' 请先在当前页面添加模型配置。'}
        </p>
        {loading && <p role="status" className="text-sm text-muted-foreground">加载中...</p>}
        {modelError && <p role="alert" className="text-sm text-destructive">{modelError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={!model} onClick={() => { setDraft({}); setNotice('') }}>跟随当前会话模型</Button>
          <Button size="sm" disabled={!changed || Boolean(modelError)} onClick={() => void save()}>{saving ? '保存中...' : '保存'}</Button>
        </div>
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    </SettingsSection>
  )
}
