import { describe, expect, test } from 'bun:test'
import { getModelLogo, getModelLogoById, getProviderLogo } from './model-logo'

describe('模型 Logo 匹配', () => {
  test('未收录的 GPT 型号回退到 OpenAI 品牌图标', () => {
    expect(getModelLogoById('gpt-6.1-sol')).toBe(getProviderLogo('openai'))
  })

  test('具体的 GPT 型号规则优先于通用兜底', () => {
    expect(getModelLogoById('gpt-5.1-codex')).not.toBe(getProviderLogo('openai'))
    expect(getModelLogoById('gpt-6-astra')).not.toBe(getProviderLogo('openai'))
  })

  test('GPT 型号不会因渠道 provider 是 anthropic 而显示 Claude 图标', () => {
    expect(getModelLogo('gpt-6.1-sol', 'anthropic')).not.toBe(getProviderLogo('anthropic'))
  })
})
