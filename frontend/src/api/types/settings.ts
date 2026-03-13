import {
  DEFAULT_TTS_CONFIG,
  DEFAULT_STT_CONFIG,
  DEFAULT_KEYBOARD_SHORTCUTS,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_LEADER_KEY,
  type TTSConfig,
  type STTConfig,
  type CoStrictConfigContent,
} from '@costrict-manager/shared'
import type { NotificationPreferences } from '@costrict-manager/shared/types'

export type { TTSConfig, STTConfig, CoStrictConfigContent, NotificationPreferences }
export { DEFAULT_TTS_CONFIG, DEFAULT_STT_CONFIG, DEFAULT_KEYBOARD_SHORTCUTS, DEFAULT_USER_PREFERENCES, DEFAULT_LEADER_KEY }

export interface CustomCommand {
  name: string
  description: string
  promptTemplate: string
}

export interface GitCredential {
  name: string
  host: string
  type: 'pat' | 'ssh'
  token?: string
  sshPrivateKey?: string
  sshPrivateKeyEncrypted?: string
  hasPassphrase?: boolean
  username?: string
  passphrase?: string
}

export interface GitIdentity {
  name: string
  email: string
}

export interface UserPreferences {
  theme: 'dark' | 'light' | 'system'
  mode: 'plan' | 'build'
  defaultModel?: string
  defaultAgent?: string
  autoScroll: boolean
  showReasoning: boolean
  expandToolCalls: boolean
  expandDiffs: boolean
  leaderKey?: string
  directShortcuts?: string[]
  keyboardShortcuts: Record<string, string>
  customCommands: CustomCommand[]
  gitCredentials?: GitCredential[]
  gitIdentity?: GitIdentity
  tts?: TTSConfig
  stt?: STTConfig
  notifications?: NotificationPreferences
  repoOrder?: number[]
  memoryDedupThreshold?: number
}

export interface SettingsResponse {
  preferences: UserPreferences
  updatedAt: number
  serverRestarted?: boolean
  reloadError?: string
}

export interface UpdateSettingsRequest {
  preferences: Partial<UserPreferences>
}

export interface CoStrictConfig {
  id: number
  name: string
  content: CoStrictConfigContent
  rawContent?: string
  isDefault: boolean
  createdAt: number
  updatedAt: number
}

export interface CreateCoStrictConfigRequest {
  name: string
  content: CoStrictConfigContent | string
  isDefault?: boolean
}

export interface UpdateCoStrictConfigRequest {
  content: CoStrictConfigContent | string
  isDefault?: boolean
}

export interface CoStrictConfigResponse {
  configs: CoStrictConfig[]
  defaultConfig: CoStrictConfig | null
}
