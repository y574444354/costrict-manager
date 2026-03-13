import { Hono } from 'hono'
import { z } from 'zod'
import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve, dirname } from 'path'
import type { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import { writeFileContent, readFileContent, fileExists } from '../services/file-operations'
import { patchCoStrictConfig, proxyToCoStrictWithDirectory } from '../services/proxy'
import { getCoStrictConfigFilePath, getAgentsMdPath, ENV } from '@costrict-manager/shared/config/env'
import {
  UserPreferencesSchema,
  CoStrictConfigSchema,
} from '../types/settings'
import type { GitCredential } from '@costrict-manager/shared'
import { logger } from '../utils/logger'
import { costrictServerManager } from '../services/costrict-server'
import { DEFAULT_AGENTS_MD } from '../constants'
import { validateSSHPrivateKey } from '../utils/ssh-validation'
import { encryptSecret } from '../utils/crypto'
import { compareVersions } from '../utils/version-utils'

function getCoStrictInstallMethod(): string {
  const homePath = process.env.HOME || ''
  const costrictPath = process.env.COSTRICT_PATH || resolve(homePath, '.costrict', 'bin', 'costrict')
  
  if (!existsSync(costrictPath)) return 'curl'
  
  try {
    const costrictDir = dirname(costrictPath)
    if (costrictDir.includes('.costrict')) return 'curl'
    
    if (costrictPath.includes('/homebrew/') || costrictPath.includes('/HOMEBREW/')) return 'brew'
    if (costrictPath.includes('/.npm/') || costrictPath.includes('/node_modules/')) return 'npm'
    if (costrictPath.includes('/.pnpm/')) return 'pnpm'
    if (costrictPath.includes('/.bun/')) return 'bun'
  } catch {
    return 'curl'
  }
  
  return 'curl'
}

function execWithTimeout(command: string, timeoutMs: number, env?: Record<string, string>): { output: string; timedOut: boolean } {
  try {
    const output = execSync(command, {
      encoding: 'utf8',
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      env: env ? { ...process.env, ...env } : undefined
    })
    return { output, timedOut: false }
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && (error as { status: number }).status === null) {
      return { output: '', timedOut: true }
    }
    if (error && typeof error === 'object' && ('stdout' in error || 'stderr' in error)) {
      const stdout = (error as { stdout?: string }).stdout || ''
      const stderr = (error as { stderr?: string }).stderr || ''
      return { output: stdout + stderr, timedOut: false }
    }
    throw error
  }
}

function spawnWithTimeout(args: string[], timeoutMs: number, env?: Record<string, string>): { output: string; timedOut: boolean } {
  const result = spawnSync(args[0]!, args.slice(1), {
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    env: env ? { ...process.env, ...env } : undefined
  })

  if (result.signal === 'SIGKILL' || result.error?.message?.includes('TIMEOUT')) {
    return { output: '', timedOut: true }
  }

  const output = (result.stdout || '') + (result.stderr || '')
  return { output, timedOut: false }
}

const UpdateSettingsSchema = z.object({
  preferences: UserPreferencesSchema.partial(),
})

const CreateCoStrictConfigSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.union([CoStrictConfigSchema, z.string()]),
  isDefault: z.boolean().optional(),
})

const UpdateCoStrictConfigSchema = z.object({
  content: z.union([CoStrictConfigSchema, z.string()]),
  isDefault: z.boolean().optional(),
})



const CreateCustomCommandSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(1000),
  promptTemplate: z.string().min(1).max(10000),
})

const UpdateCustomCommandSchema = z.object({
  description: z.string().min(1).max(1000),
  promptTemplate: z.string().min(1).max(10000),
})



const ConnectMcpDirectorySchema = z.object({
  directory: z.string().min(1),
})

const McpAuthDirectorySchema = ConnectMcpDirectorySchema

const TestSSHConnectionSchema = z.object({
  host: z.string().min(1),
  sshPrivateKey: z.string().min(1),
  passphrase: z.string().optional(),
})


async function extractCoStrictError(response: Response, defaultError: string): Promise<string> {
  const errorObj = await response.json().catch(() => null)
  return (errorObj && typeof errorObj === 'object' && 'error' in errorObj)
    ? String(errorObj.error)
    : defaultError
}

export function createSettingsRoutes(db: Database) {
  const app = new Hono()
  const settingsService = new SettingsService(db)

  app.get('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = settingsService.getSettings(userId)
      return c.json(settings)
    } catch (error) {
      logger.error('Failed to get settings:', error)
      return c.json({ error: 'Failed to get settings' }, 500)
    }
  })

  app.get('/memory-plugin-status', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configs = settingsService.getCostrictConfigs(userId)
      const defaultConfig = configs.configs.find((cfg: { isDefault: boolean }) => cfg.isDefault)
      const isEnabled = defaultConfig?.content?.plugin?.includes('@costrict-manager/memory') ?? false
      return c.json({ memoryPluginEnabled: isEnabled })
    } catch (error) {
      logger.error('Failed to get memory plugin status:', error)
      return c.json({ error: 'Failed to get memory plugin status' }, 500)
    }
  })

  app.patch('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = UpdateSettingsSchema.parse(body)

      if (validated.preferences.gitCredentials) {
        const validations = await Promise.all(
          validated.preferences.gitCredentials.map(async (cred: GitCredential) => {
            if (cred.type === 'ssh' && cred.sshPrivateKey) {
              const validation = await validateSSHPrivateKey(cred.sshPrivateKey)
              if (!validation.valid) {
                throw new Error(`Invalid SSH key for credential '${cred.name}': ${validation.error}`)
              }

              const result: GitCredential = {
                ...cred,
                sshPrivateKeyEncrypted: encryptSecret(cred.sshPrivateKey),
                hasPassphrase: validation.hasPassphrase,
                passphrase: cred.passphrase ? encryptSecret(cred.passphrase) : undefined,
              }
              delete result.sshPrivateKey
              return result
            }
            return cred
          })
        )
        validated.preferences.gitCredentials = validations
      }

      const currentSettings = settingsService.getSettings(userId)
      const settings = settingsService.updateSettings(validated.preferences, userId)

      let serverRestarted = false

      const credentialsChanged = validated.preferences.gitCredentials !== undefined &&
        JSON.stringify(currentSettings.preferences.gitCredentials || []) !== JSON.stringify(validated.preferences.gitCredentials)

      const identityChanged = validated.preferences.gitIdentity !== undefined &&
        JSON.stringify(currentSettings.preferences.gitIdentity || {}) !== JSON.stringify(validated.preferences.gitIdentity)

      let reloadError: string | undefined
      if (credentialsChanged || identityChanged) {
        const changeType = [credentialsChanged && 'credentials', identityChanged && 'identity'].filter(Boolean).join(' and ')
        logger.info(`Git ${changeType} changed, reloading CoStrict configuration`)
        try {
          await costrictServerManager.reloadConfig()
          serverRestarted = true
        } catch (error) {
          logger.warn('Failed to reload CoStrict config after git settings change:', error)
          reloadError = error instanceof Error ? error.message : 'Unknown error'
        }
      }

      return c.json({ ...settings, serverRestarted, reloadError })
    } catch (error) {
      logger.error('Failed to update settings:', error)
      if (error instanceof Error && error.message.startsWith('Invalid SSH key')) {
        return c.json({ error: error.message }, 400)
      }
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid settings data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update settings' }, 500)
    }
  })

  app.delete('/', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = settingsService.resetSettings(userId)
      return c.json(settings)
    } catch (error) {
      logger.error('Failed to reset settings:', error)
      return c.json({ error: 'Failed to reset settings' }, 500)
    }
  })

  // CoStrict Config routes
  app.get('/costrict-configs', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configs = settingsService.getCostrictConfigs(userId)
      return c.json(configs)
    } catch (error) {
      logger.error('Failed to get CoStrict configs:', error)
      return c.json({ error: 'Failed to get CoStrict configs' }, 500)
    }
  })

  app.post('/costrict-configs', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = CreateCoStrictConfigSchema.parse(body)
      
      const config = settingsService.createCoStrictConfig(validated, userId)
      
      if (config.isDefault) {
        const configPath = getCoStrictConfigFilePath()
        await writeFileContent(configPath, config.rawContent)
        logger.info(`Wrote default config to: ${configPath}`)
        
        const patchResult = await patchCoStrictConfig(config.content)
        if (!patchResult.success) {
          return c.json({ error: 'Config saved but failed to apply', details: patchResult.error }, 500)
        }
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to create CoStrict config:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      if (error instanceof Error && error.message.includes('already exists')) {
        return c.json({ error: error.message }, 409)
      }
      return c.json({ error: 'Failed to create CoStrict config' }, 500)
    }
  })

  app.put('/costrict-configs/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')
      const body = await c.req.json()
      const validated = UpdateCoStrictConfigSchema.parse(body)
      
      const existingConfig = settingsService.getCoStrictConfigByName(configName, userId)
      const existingAgents = existingConfig?.content?.agent
      
      const config = settingsService.updateCoStrictConfig(configName, validated, userId)
      if (!config) {
        return c.json({ error: 'Config not found' }, 404)
      }
      
      if (config.isDefault) {
        const configPath = getCoStrictConfigFilePath()
        await writeFileContent(configPath, config.rawContent)
        logger.info(`Wrote default config to: ${configPath}`)
        
        const newAgents = config.content?.agent
        const agentsChanged = JSON.stringify(existingAgents) !== JSON.stringify(newAgents)
        
        if (agentsChanged) {
          logger.info('Agent configuration changed, restarting CoStrict server')
          await costrictServerManager.restart()
        } else {
          const patchResult = await patchCoStrictConfig(config.content)
          if (!patchResult.success) {
            return c.json({ error: 'Config saved but failed to apply', details: patchResult.error }, 500)
          }
        }
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to update CoStrict config:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update CoStrict config' }, 500)
    }
  })

  app.delete('/costrict-configs/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')
      
      const deleted = settingsService.deleteCoStrictConfig(configName, userId)
      if (!deleted) {
        return c.json({ error: 'Config not found' }, 404)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete CoStrict config:', error)
      return c.json({ error: 'Failed to delete CoStrict config' }, 500)
    }
  })

  app.post('/costrict-configs/:name/set-default', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const configName = c.req.param('name')

      settingsService.saveLastKnownGoodConfig(userId)

      const config = settingsService.setDefaultCoStrictConfig(configName, userId)
      if (!config) {
        return c.json({ error: 'Config not found' }, 404)
      }

      const configPath = getCoStrictConfigFilePath()
      await writeFileContent(configPath, config.rawContent)
      logger.info(`Wrote default config '${configName}' to: ${configPath}`)

      const patchResult = await patchCoStrictConfig(config.content)
      if (!patchResult.success) {
        return c.json({ error: 'Config saved but failed to apply', details: patchResult.error }, 500)
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to set default CoStrict config:', error)
      return c.json({ error: 'Failed to set default CoStrict config' }, 500)
    }
  })

  app.get('/costrict-configs/default', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const config = settingsService.getDefaultCoStrictConfig(userId)
      
      if (!config) {
        return c.json({ error: 'No default config found' }, 404)
      }
      
      return c.json(config)
    } catch (error) {
      logger.error('Failed to get default CoStrict config:', error)
      return c.json({ error: 'Failed to get default CoStrict config' }, 500)
    }
  })

  app.post('/costrict-restart', async (c) => {
    try {
      logger.info('Manual CoStrict server restart requested')
      costrictServerManager.clearStartupError()
      await costrictServerManager.restart()
      return c.json({ success: true, message: 'CoStrict server restarted successfully' })
    } catch (error) {
      logger.error('Failed to restart CoStrict server:', error)
      const startupError = costrictServerManager.getLastStartupError()
      return c.json({
        error: 'Failed to restart CoStrict server',
        details: startupError || (error instanceof Error ? error.message : 'Unknown error')
      }, 500)
    }
  })

  app.post('/costrict-reload', async (c) => {
    try {
      logger.info('CoStrict configuration reload requested')
      await fetch(`http://${ENV.COSTRICT.HOST}:${ENV.COSTRICT.PORT}/config`, {
        method: 'GET'
      })
      await costrictServerManager.reloadConfig()
      return c.json({ success: true, message: 'CoStrict configuration reloaded successfully' })
    } catch (error) {
      logger.error('Failed to reload CoStrict config:', error)
      return c.json({
        error: 'Failed to reload CoStrict configuration',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/costrict-rollback', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      logger.info('CoStrict config rollback requested')

      const rollbackConfig = settingsService.rollbackToLastKnownGoodHealth(userId)
      if (!rollbackConfig) {
        return c.json({ error: 'No previous working config available for rollback' }, 404)
      }

      const configPath = getCoStrictConfigFilePath()
      const config = settingsService.getDefaultCoStrictConfig(userId)
      if (!config) {
        return c.json({ error: 'Failed to get default config after rollback' }, 500)
      }

      await writeFileContent(configPath, config.rawContent)
      logger.info(`Rolled back to config '${rollbackConfig}'`)

      costrictServerManager.clearStartupError()
      try {
        await costrictServerManager.reloadConfig()
      } catch (reloadError) {
        logger.error('Rollback config reload failed, attempting restart:', reloadError)

        const deleted = settingsService.deleteFilesystemConfig()
        if (deleted) {
          logger.info('Deleted filesystem config, attempting restart with fallback')
          await new Promise(r => setTimeout(r, 1000))

          costrictServerManager.clearStartupError()
          await costrictServerManager.restart()

          return c.json({
            success: true,
            message: `Server restarted after deleting problematic config. DB config '${rollbackConfig}' preserved for manual recovery.`,
            fallback: true,
            configName: rollbackConfig
          })
        }

        return c.json({
          error: 'Failed to rollback and could not delete filesystem config',
          details: reloadError instanceof Error ? reloadError.message : 'Unknown error'
        }, 500)
      }

      return c.json({
        success: true,
        message: `Server reloaded with previous working config: ${rollbackConfig}`,
        configName: rollbackConfig
      })
    } catch (error) {
      logger.error('Failed to rollback CoStrict config:', error)
      return c.json({ error: 'Failed to rollback CoStrict config' }, 500)
    }
  })

  app.post('/costrict-upgrade', async (c) => {
    const oldVersion = costrictServerManager.getVersion()
    logger.info(`Current CoStrict version: ${oldVersion}`)

    try {
      const installMethod = getCoStrictInstallMethod()
      logger.info(`Running costrict upgrade --method ${installMethod} with 90s timeout...`)
      const { output: upgradeOutput, timedOut } = execWithTimeout(`costrict upgrade --method ${installMethod} 2>&1`, 90000)
      logger.info(`Upgrade output: ${upgradeOutput}`)

      if (timedOut) {
        logger.warn('CoStrict upgrade timed out after 90 seconds')
        throw new Error('Upgrade command timed out after 90 seconds')
      }

      const newVersion = costrictServerManager.getVersion() || await costrictServerManager.fetchVersion()
      logger.info(`New CoStrict version: ${newVersion}`)

      const upgraded = oldVersion && newVersion && compareVersions(newVersion, oldVersion) > 0

      if (upgraded) {
        logger.info(`CoStrict upgraded from v${oldVersion} to v${newVersion}`)
        costrictServerManager.clearStartupError()
        try {
          await costrictServerManager.reloadConfig()
          logger.info('CoStrict server reloaded after upgrade')
        } catch (reloadError) {
          logger.warn('Config reload after upgrade failed, attempting full restart:', reloadError)
          await costrictServerManager.restart()
          logger.info('CoStrict server restarted after upgrade')
        }

        return c.json({
          success: true,
          message: `CoStrict upgraded from v${oldVersion} to v${newVersion} and configuration reloaded`,
          oldVersion,
          newVersion,
          upgraded: true
        })
      } else {
        logger.info('CoStrict is already up to date or version unchanged')
        return c.json({
          success: true,
          message: 'CoStrict is already up to date',
          oldVersion,
          newVersion,
          upgraded: false
        })
      }
    } catch (error) {
      logger.error('Failed to upgrade CoStrict:', error)
      logger.warn('Attempting to recover CoStrict server...')

      let recovered = false
      let recoveryMessage = ''

      costrictServerManager.clearStartupError()
      try {
        await costrictServerManager.restart()
        logger.warn('CoStrict server restarted after upgrade failure')
        recovered = true
        recoveryMessage = 'Server recovered'
      } catch (recoveryError) {
        logger.error('Failed to recover CoStrict server:', recoveryError)
        recovered = false
        recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown error'
      }

      let currentVersion: string | null | undefined = oldVersion
      try {
        currentVersion = costrictServerManager.getVersion() || oldVersion
      } catch (versionError) {
        logger.error('Failed to get version after recovery:', versionError)
        currentVersion = oldVersion
      }

      return c.json(
        recovered ? {
          success: false,
          error: 'Upgrade failed but server recovered',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          upgraded: false,
          recovered: true,
          recoveryMessage
        } : {
          error: 'Failed to upgrade CoStrict and could not recover',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          upgraded: false,
          recovered: false,
          recoveryMessage
        },
        recovered ? 400 : 500
      )
    }
  })

  app.get('/costrict-versions', async (c) => {
    try {
      logger.info('Fetching available CoStrict versions from GitHub')
      
      const response = await fetch('https://api.github.com/repos/sst/costrict/releases?per_page=20', {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'costrict-manager'
        }
      })
      
      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`)
      }
      
      const releases = await response.json() as Array<{
        tag_name: string
        name: string
        published_at: string
        prerelease: boolean
      }>
      
      const versions = releases
        .filter(r => !r.prerelease)
        .map(r => ({
          version: r.tag_name.replace(/^v/, ''),
          tag: r.tag_name,
          name: r.name,
          publishedAt: r.published_at
        }))
      
      const currentVersion = costrictServerManager.getVersion()
      
      return c.json({
        versions,
        currentVersion
      })
    } catch (error) {
      logger.error('Failed to fetch CoStrict versions:', error)
      return c.json({
        error: 'Failed to fetch versions',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, 500)
    }
  })

  app.post('/costrict-install-version', async (c) => {
    const oldVersion = costrictServerManager.getVersion()
    logger.info(`Current CoStrict version: ${oldVersion}`)

    try {
      const body = await c.req.json()
      const { version } = z.object({ version: z.string().min(1) }).parse(body)

      logger.info(`Installing CoStrict version: ${version}`)
      const versionArg = version.startsWith('v') ? version : `v${version}`
      const installMethod = getCoStrictInstallMethod()
      logger.info(`Running costrict upgrade ${versionArg} --method ${installMethod} with 90s timeout...`)

      const { output: upgradeOutput, timedOut } = execWithTimeout(`costrict upgrade ${versionArg} --method ${installMethod} 2>&1`, 90000)
      logger.info(`Upgrade output: ${upgradeOutput}`)

      if (timedOut) {
        logger.warn('CoStrict version install timed out after 90 seconds')
        throw new Error('Version install command timed out after 90 seconds')
      }

      const newVersion = await costrictServerManager.fetchVersion()
      logger.info(`New CoStrict version: ${newVersion}`)

      costrictServerManager.clearStartupError()
      await costrictServerManager.restart()
      logger.info('CoStrict server restarted after version change')

      return c.json({
        success: true,
        message: `CoStrict ${oldVersion ? `changed from v${oldVersion} to` : 'installed as'} v${newVersion}`,
        oldVersion,
        newVersion
      })
    } catch (error) {
      logger.error('Failed to install CoStrict version:', error)
      logger.warn('Attempting to recover CoStrict server...')

      let recovered = false
      let recoveryMessage = ''

      costrictServerManager.clearStartupError()
      try {
        await costrictServerManager.restart()
        logger.warn('CoStrict server restarted after install failure')
        recovered = true
        recoveryMessage = 'Server recovered'
      } catch (recoveryError) {
        logger.error('Failed to recover CoStrict server:', recoveryError)
        recovered = false
        recoveryMessage = recoveryError instanceof Error ? recoveryError.message : 'Unknown error'
      }

      const currentVersion = costrictServerManager.getVersion() || oldVersion

      return c.json(
        recovered ? {
          success: false,
          error: 'Version install failed but server recovered',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          recovered: true,
          recoveryMessage
        } : {
          error: 'Failed to install CoStrict version and could not recover',
          details: error instanceof Error ? error.message : 'Unknown error',
          oldVersion,
          newVersion: currentVersion,
          recovered: false,
          recoveryMessage
        },
        recovered ? 400 : 500
      )
    }
  })

  // Custom Commands routes
  app.get('/custom-commands', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = settingsService.getSettings(userId)
      return c.json(settings.preferences.customCommands)
    } catch (error) {
      logger.error('Failed to get custom commands:', error)
      return c.json({ error: 'Failed to get custom commands' }, 500)
    }
  })

  app.post('/custom-commands', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = CreateCustomCommandSchema.parse(body)
      
      const settings = settingsService.getSettings(userId)
      const existingCommand = settings.preferences.customCommands.find(cmd => cmd.name === validated.name)
      if (existingCommand) {
        return c.json({ error: 'Command with this name already exists' }, 409)
      }
      
      settingsService.updateSettings({
        customCommands: [...settings.preferences.customCommands, validated]
      }, userId)
      
      return c.json(validated)
    } catch (error) {
      logger.error('Failed to create custom command:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to create custom command' }, 500)
    }
  })

  app.put('/custom-commands/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const commandName = decodeURIComponent(c.req.param('name'))
      const body = await c.req.json()
      const validated = UpdateCustomCommandSchema.parse(body)
      
      const settings = settingsService.getSettings(userId)
      const commandIndex = settings.preferences.customCommands.findIndex(cmd => cmd.name === commandName)
      if (commandIndex === -1) {
        return c.json({ error: 'Command not found' }, 404)
      }
      
      const updatedCommands = [...settings.preferences.customCommands]
      updatedCommands[commandIndex] = {
        name: commandName,
        description: validated.description,
        promptTemplate: validated.promptTemplate
      }
      
      settingsService.updateSettings({
        customCommands: updatedCommands
      }, userId)
      
      return c.json(updatedCommands[commandIndex])
    } catch (error) {
      logger.error('Failed to update custom command:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid command data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update custom command' }, 500)
    }
  })

  app.delete('/custom-commands/:name', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const commandName = decodeURIComponent(c.req.param('name'))
      
      const settings = settingsService.getSettings(userId)
      const commandExists = settings.preferences.customCommands.some(cmd => cmd.name === commandName)
      if (!commandExists) {
        return c.json({ error: 'Command not found' }, 404)
      }
      
      const updatedCommands = settings.preferences.customCommands.filter(cmd => cmd.name !== commandName)
      settingsService.updateSettings({
        customCommands: updatedCommands
      }, userId)
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete custom command:', error)
      return c.json({ error: 'Failed to delete custom command' }, 500)
    }
  })

  app.get('/agents-md', async (c) => {
    try {
      const agentsMdPath = getAgentsMdPath()
      const exists = await fileExists(agentsMdPath)
      
      if (!exists) {
        return c.json({ content: '' })
      }
      
      const content = await readFileContent(agentsMdPath)
      return c.json({ content })
    } catch (error) {
      logger.error('Failed to get AGENTS.md:', error)
      return c.json({ error: 'Failed to get AGENTS.md' }, 500)
    }
  })

  app.get('/agents-md/default', async (c) => {
    return c.json({ content: DEFAULT_AGENTS_MD })
  })

  app.put('/agents-md', async (c) => {
    try {
      const body = await c.req.json()
      const { content } = z.object({ content: z.string() }).parse(body)
      
      const agentsMdPath = getAgentsMdPath()
      await writeFileContent(agentsMdPath, content)
      logger.info(`Updated AGENTS.md at: ${agentsMdPath}`)
      
      await costrictServerManager.restart()
      logger.info('Restarted CoStrict server after AGENTS.md update')
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to update AGENTS.md:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update AGENTS.md' }, 500)
    }
  })

  app.post('/test-ssh', async (c) => {
    try {
      const body = await c.req.json()
      const { host, sshPrivateKey, passphrase } = TestSSHConnectionSchema.parse(body)

      logger.info(`Testing SSH connection to ${host}`)

      const validation = await validateSSHPrivateKey(sshPrivateKey)
      if (!validation.valid) {
        return c.json({
          success: false,
          message: validation.error || 'Invalid SSH key'
        }, 400)
      }

      const { writeTemporarySSHKey, cleanupSSHKey, parseSSHHost } = await import('../utils/ssh-key-manager')

      let keyPath: string | null = null
      try {
        keyPath = await writeTemporarySSHKey(sshPrivateKey, 'test')

        const { user, host: sshHost, port } = parseSSHHost(host)

        const sshArgs = [
          '-T',
          '-i', keyPath,
          '-o', 'IdentitiesOnly=yes',
          '-o', 'PasswordAuthentication=no',
          '-o', 'StrictHostKeyChecking=accept-new',
          '-o', 'UserKnownHostsFile=/dev/null',
        ]

        if (port && port !== '22') {
          sshArgs.push('-p', port)
        }

        sshArgs.push(`${user}@${sshHost}`)

        let executable = 'ssh'
        const env: Record<string, string> = {}
        if (passphrase) {
          executable = 'sshpass'
          sshArgs.unshift('-e', 'ssh')
          env.SSHPASS = passphrase
        }

        const { output, timedOut } = spawnWithTimeout([executable, ...sshArgs], 30000, env)

        if (timedOut) {
          logger.warn(`SSH connection test to ${host} timed out`)
          return c.json({
            success: false,
            message: 'Connection timed out. This may indicate a network issue or an incorrect host.'
          })
        }

        const outputStr = String(output)

        if (outputStr.includes('Permission denied') || outputStr.includes('Access denied')) {
          return c.json({
            success: false,
            message: 'Permission denied. The SSH key may not be authorized on this host, or the passphrase is incorrect.'
          })
        }

        if (outputStr.includes('Could not resolve hostname') || outputStr.includes('Name or service not known')) {
          return c.json({
            success: false,
            message: 'Could not resolve hostname. Please check that the host is correct and accessible.'
          })
        }

        if (outputStr.includes('Connection refused') || outputStr.includes('Connection timed out')) {
          return c.json({
            success: false,
            message: 'Connection refused or timed out. The host may be down or not accepting SSH connections.'
          })
        }

        const authenticated = outputStr.includes('successfully authenticated') ||
                              outputStr.includes('You\'ve successfully authenticated') ||
                              outputStr.includes('Welcome to')

        if (authenticated) {
          logger.info(`SSH connection test to ${host} succeeded`)
          return c.json({
            success: true,
            message: `Successfully connected to ${host}`
          })
        }

        logger.warn(`SSH connection test to ${host} returned ambiguous output: ${outputStr}`)
        return c.json({
          success: false,
          message: `Authentication failed. The key may not be authorized on this host. Details: ${outputStr.trim().substring(0, 200)}`
        })

      } finally {
        if (keyPath) {
          await cleanupSSHKey(keyPath)
        }
      }
    } catch (error) {
      logger.error('Failed to test SSH connection:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to test SSH connection'
      }, 500)
    }
  })

  // MCP directory-aware endpoints
  app.post('/mcp/:name/connectdirectory', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await proxyToCoStrictWithDirectory(
        `/mcp/${encodeURIComponent(serverName)}/connect`,
        'POST',
        directory
      )
      
      if (!response.ok) {
        const errorMsg = await extractCoStrictError(response, 'Failed to connect MCP server')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to connect MCP server for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to connect MCP server' }, 500)
    }
  })

  app.post('/mcp/:name/disconnectdirectory', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await proxyToCoStrictWithDirectory(
        `/mcp/${encodeURIComponent(serverName)}/disconnect`,
        'POST',
        directory
      )
      
      if (!response.ok) {
        const errorMsg = await extractCoStrictError(response, 'Failed to disconnect MCP server')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to disconnect MCP server for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to disconnect MCP server' }, 500)
    }
  })

  app.post('/mcp/:name/authdirectedir', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = McpAuthDirectorySchema.parse(body)
      
      const response = await proxyToCoStrictWithDirectory(
        `/mcp/${encodeURIComponent(serverName)}/auth/authenticate`,
        'POST',
        directory,
      )
      
      if (!response.ok) {
        const errorMsg = await extractCoStrictError(response, 'Failed to authenticate MCP server')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json(await response.json())
    } catch (error) {
      logger.error('Failed to authenticate MCP server for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to authenticate MCP server' }, 500)
    }
  })

  app.delete('/mcp/:name/authdir', async (c) => {
    try {
      const serverName = c.req.param('name')
      const body = await c.req.json()
      const { directory } = ConnectMcpDirectorySchema.parse(body)
      
      const response = await proxyToCoStrictWithDirectory(
        `/mcp/${encodeURIComponent(serverName)}/auth`,
        'DELETE',
        directory
      )
      
      if (!response.ok) {
        const errorMsg = await extractCoStrictError(response, 'Failed to remove MCP auth')
        return c.json({ error: errorMsg }, 400)
      }
      
      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to remove MCP auth for directory:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to remove MCP auth' }, 500)
    }
  })

  return app
}
