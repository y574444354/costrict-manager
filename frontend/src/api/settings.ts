import type { 
  SettingsResponse, 
  UpdateSettingsRequest, 
  CoStrictConfig,
  CoStrictConfigResponse,
  CreateCoStrictConfigRequest,
  UpdateCoStrictConfigRequest
} from './types/settings'
import { API_BASE_URL } from '@/config'
import { fetchWrapper, FetchError } from './fetchWrapper'

const DEFAULT_USER_ID = 'default'

export const settingsApi = {
  getSettings: async (userId = DEFAULT_USER_ID): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      params: { userId },
    })
  },

  updateSettings: async (
    updates: UpdateSettingsRequest,
    userId = DEFAULT_USER_ID
  ): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      method: 'PATCH',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  },

  resetSettings: async (userId = DEFAULT_USER_ID): Promise<SettingsResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings`, {
      method: 'DELETE',
      params: { userId },
    })
  },

  getCoStrictConfigs: async (userId = DEFAULT_USER_ID): Promise<CoStrictConfigResponse> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-configs`, {
      params: { userId },
    })
  },

  createCoStrictConfig: async (
    request: CreateCoStrictConfigRequest,
    userId = DEFAULT_USER_ID
  ): Promise<CoStrictConfig> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-configs`, {
      method: 'POST',
      params: { userId },
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  },

  updateCoStrictConfig: async (
    configName: string,
    request: UpdateCoStrictConfigRequest,
    userId = DEFAULT_USER_ID
  ): Promise<CoStrictConfig> => {
    return fetchWrapper(
      `${API_BASE_URL}/api/settings/costrict-configs/${encodeURIComponent(configName)}`,
      {
        method: 'PUT',
        params: { userId },
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      }
    )
  },

  deleteCoStrictConfig: async (
    configName: string,
    userId = DEFAULT_USER_ID
  ): Promise<boolean> => {
    await fetchWrapper(
      `${API_BASE_URL}/api/settings/costrict-configs/${encodeURIComponent(configName)}`,
      {
        method: 'DELETE',
        params: { userId },
      }
    )
    return true
  },

  setDefaultCoStrictConfig: async (
    configName: string,
    userId = DEFAULT_USER_ID
  ): Promise<CoStrictConfig> => {
    return fetchWrapper(
      `${API_BASE_URL}/api/settings/costrict-configs/${encodeURIComponent(configName)}/set-default`,
      {
        method: 'POST',
        params: { userId },
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }
    )
  },

  getDefaultCoStrictConfig: async (userId = DEFAULT_USER_ID): Promise<CoStrictConfig | null> => {
    try {
      return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-configs/default`, {
        params: { userId },
      })
    } catch {
      return null
    }
  },

  restartCoStrictServer: async (): Promise<{ success: boolean; message: string; details?: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-restart`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  reloadCoStrictConfig: async (): Promise<{ success: boolean; message: string; details?: string }> => {
    try {
      return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      if (error instanceof FetchError && error.statusCode === 404) {
        return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-restart`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      }
      throw error
    }
  },

  rollbackCoStrictConfig: async (): Promise<{ success: boolean; message: string; configName?: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-rollback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  getCoStrictVersions: async (): Promise<{
    versions: Array<{
      version: string
      tag: string
      name: string
      publishedAt: string
    }>
    currentVersion: string | null
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-versions`)
  },

  installCoStrictVersion: async (version: string): Promise<{
    success: boolean
    message: string
    oldVersion?: string
    newVersion?: string
    recovered?: boolean
    recoveryMessage?: string
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-install-version`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version }),
    })
  },

  upgradeCoStrict: async (): Promise<{
    success: boolean
    message: string
    oldVersion?: string
    newVersion?: string
    upgraded: boolean
    recovered?: boolean
    recoveryMessage?: string
  }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/costrict-upgrade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  },

  testSSHConnection: async (host: string, sshPrivateKey: string, passphrase?: string): Promise<{ success: boolean; message: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/test-ssh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, sshPrivateKey, passphrase }),
    })
  },

  getAgentsMd: async (): Promise<{ content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md`)
  },

  getDefaultAgentsMd: async (): Promise<{ content: string }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md/default`)
  },

  updateAgentsMd: async (content: string): Promise<{ success: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/agents-md`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    })
  },

  getVersionInfo: async (): Promise<VersionInfo> => {
    return fetchWrapper(`${API_BASE_URL}/api/health/version`)
  },

  getMemoryPluginStatus: async (): Promise<{ memoryPluginEnabled: boolean }> => {
    return fetchWrapper(`${API_BASE_URL}/api/settings/memory-plugin-status`)
  },
}

export interface VersionInfo {
  currentVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  releaseUrl: string | null
  releaseName: string | null
}
