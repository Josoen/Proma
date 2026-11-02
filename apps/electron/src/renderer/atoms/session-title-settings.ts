import { atom } from 'jotai'
import type { SessionTitleSettings } from '@/types/settings'

/** 仅包含主进程确认已保存的标题模型设置。 */
export const sessionTitleSettingsAtom = atom<SessionTitleSettings>({})
