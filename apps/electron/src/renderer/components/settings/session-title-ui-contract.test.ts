import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./ChannelSettings.tsx', import.meta.url), 'utf8')
const title = readFileSync(new URL('./SessionTitleSettings.tsx', import.meta.url), 'utf8')
const selector = readFileSync(new URL('../chat/ModelSelector.tsx', import.meta.url), 'utf8')

// 静态检查入口与控件契约；实际键盘操作及保存反馈仍需桌面端冒烟验证。
describe('标题模型设置 UI 契约', () => {
  test('Given the model configuration list When rendering Then mounts title settings after channels and removes only the commercial banner', () => {
    expect(source.indexOf('<SessionTitleSettings />')).toBeGreaterThan(source.indexOf('channels.map'))
    for (const removed of ['PromaProviderCard', 'openPromaDownload', 'PromaLogo', 'ExternalLink', '下载商业版']) expect(source).not.toContain(removed)
    for (const preserved of ['<ChannelForm', '<AuthorizationSuccessNotice', '<ChannelRow', 'handleDeleteConfirm', '<AlertDialog']) expect(source).toContain(preserved)
  })

  test('Given independent title settings When choosing a model Then uses controlled selection and has no Prompt editor', () => {
    expect(title).toContain('externalSelectedModel={model ?? null}')
    expect(title).toContain('onModelSelect=')
    expect(selector.indexOf('if (onModelSelect)')).toBeLessThan(selector.indexOf('setGlobalModel({'))
    expect(title).not.toMatch(/<Textarea|<textarea|promptTemplate/)
    expect(title).toContain('off（关闭）')
    expect(title).toContain('跟随当前会话模型')
    expect(title).toContain('role="alert"')
    expect(title).toContain('disabled={loading || saving}')
  })
})
