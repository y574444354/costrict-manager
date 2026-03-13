import { spawn, execSync } from 'child_process'
import path from 'path'
import { promises as fs } from 'fs'
import { logger } from '../utils/logger'
import { createGitEnv, createGitIdentityEnv, resolveGitIdentity } from '../utils/git-auth'
import type { GitCredential } from '@costrict-manager/shared'
import {
  buildSSHCommandWithKnownHosts,
  buildSSHCommandWithConfig,
  writePersistentSSHKey,
  stripKeyPassphrase,
  writeSSHConfig,
  generateSSHConfig,
  cleanupPersistentSSHKeys,
  parseSSHHost
} from '../utils/ssh-key-manager'
import { decryptSecret } from '../utils/crypto'
import { SettingsService } from './settings'
import { getWorkspacePath, getCoStrictConfigFilePath, ENV } from '@costrict-manager/shared/config/env'
import type { Database } from 'bun:sqlite'
import { compareVersions } from '../utils/version-utils'

const COSTRICT_SERVER_PORT = ENV.COSTRICT.PORT
const COSTRICT_SERVER_HOST = ENV.COSTRICT.HOST
const MIN_COSTRICT_VERSION = '1.0.137'
const MAX_STDERR_SIZE = 10240

// Helper getters to ensure values are computed at runtime (not module load time)
// This allows proper mocking in tests
const getCoStrictServerDirectory = () => getWorkspacePath()
const getCoStrictConfigPath = () => getCoStrictConfigFilePath()

class CoStrictServerManager {
  private static instance: CoStrictServerManager
  private serverProcess: ReturnType<typeof spawn> | null = null
  private serverPid: number | null = null
  private isHealthy: boolean = false
  private db: Database | null = null
  private version: string | null = null
  private lastStartupError: string | null = null

  private constructor() {}

  setDatabase(db: Database) {
    this.db = db
  }

  static getInstance(): CoStrictServerManager {
    if (!CoStrictServerManager.instance) {
      CoStrictServerManager.instance = new CoStrictServerManager()
    }
    return CoStrictServerManager.instance
  }

  /**
   * Test-only method to reset the singleton instance.
   * Should only be used in test setup/teardown.
   */
  static resetInstance(): void {
    CoStrictServerManager.instance = null as unknown as CoStrictServerManager
  }

  async start(): Promise<void> {
    if (this.isHealthy) {
      logger.info('CoStrict server already running and healthy')
      return
    }

    const isDevelopment = ENV.SERVER.NODE_ENV !== 'production'

    let gitCredentials: GitCredential[] = []
    let gitIdentityEnv: Record<string, string> = {}
    if (this.db) {
      try {
        const settingsService = new SettingsService(this.db)
        const settings = settingsService.getSettings('default')
        gitCredentials = settings.preferences.gitCredentials || []
        
        const identity = await resolveGitIdentity(settings.preferences.gitIdentity, gitCredentials)
        if (identity) {
          gitIdentityEnv = createGitIdentityEnv(identity)
          logger.info(`Git identity resolved: ${identity.name} <${identity.email}>`)
        }
      } catch (error) {
        logger.warn('Failed to get git settings:', error)
      }
    }

    const existingProcesses = await this.findProcessesByPort(COSTRICT_SERVER_PORT)
    if (existingProcesses.length > 0) {
      logger.info(`CoStrict server already running on port ${COSTRICT_SERVER_PORT}`)
      const healthy = await this.checkHealth()
      if (healthy) {
        if (isDevelopment) {
          logger.warn('Development mode: Killing existing server for hot reload')
          for (const proc of existingProcesses) {
            try {
              process.kill(proc.pid, 'SIGKILL')
            } catch (error) {
              logger.warn(`Failed to kill process ${proc.pid}:`, error)
            }
          }
          await new Promise(r => setTimeout(r, 2000))
        } else {
          this.isHealthy = true
          if (existingProcesses[0]) {
            this.serverPid = existingProcesses[0].pid
          }
          return
        }
      } else {
        logger.warn('Killing unhealthy CoStrict server')
        for (const proc of existingProcesses) {
          try {
            process.kill(proc.pid, 'SIGKILL')
          } catch (error) {
            logger.warn(`Failed to kill process ${proc.pid}:`, error)
          }
        }
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    const costrictServerDirectory = getCoStrictServerDirectory()
    const costrictConfigPath = getCoStrictConfigPath()
    logger.info(`CoStrict server working directory: ${costrictServerDirectory}`)
    logger.info(`CoStrict XDG_CONFIG_HOME: ${path.join(costrictServerDirectory, '.config')}`)
    logger.info(`CoStrict will use ?directory= parameter for session isolation`)

    const gitEnv = createGitEnv(gitCredentials)
    const knownHostsPath = path.join(getWorkspacePath(), 'config', 'known_hosts')
    let gitSshCommand: string
    let sshConfigPath: string | null = null

    const sshCredentials = gitCredentials.filter(cred => cred.type === 'ssh' && cred.sshPrivateKeyEncrypted)
    if (sshCredentials.length > 0) {
      logger.info(`Setting up ${sshCredentials.length} SSH credential(s) for CoStrict server`)

      const sshConfigEntries: Array<{ hostname: string, port: string, keyPath: string }> = []

      for (const cred of sshCredentials) {
        try {
          const { host, port } = parseSSHHost(cred.host)
          const privateKey = decryptSecret(cred.sshPrivateKeyEncrypted!)
          const keyPath = await writePersistentSSHKey(privateKey, cred.name)

          if (cred.passphrase) {
            const passphrase = decryptSecret(cred.passphrase)
            await stripKeyPassphrase(keyPath, passphrase)
            logger.info(`Stripped passphrase from SSH key for ${cred.name} (${host}:${port})`)
          } else {
            logger.info(`Setup SSH key for ${cred.name} (${host}:${port}): ${keyPath}`)
          }

          sshConfigEntries.push({ hostname: host, port, keyPath })
        } catch (error) {
          logger.error(`Failed to setup SSH key for ${cred.name}:`, error)
        }
      }

      if (sshConfigEntries.length > 0) {
        const sshConfigContent = generateSSHConfig(sshConfigEntries)
        sshConfigPath = path.join(getWorkspacePath(), 'config', 'ssh_config')
        await writeSSHConfig(sshConfigPath, sshConfigContent)
        gitSshCommand = buildSSHCommandWithConfig(sshConfigPath, knownHostsPath)
        logger.info(`CoStrict server SSH config written to ${sshConfigPath} with ${sshConfigEntries.length} host(s)`)
      } else {
        gitSshCommand = buildSSHCommandWithKnownHosts(knownHostsPath)
        logger.warn(`No SSH credentials could be set up, using default known_hosts only`)
      }
    } else {
      gitSshCommand = buildSSHCommandWithKnownHosts(knownHostsPath)
    }

    logger.info(`CoStrict server GIT_SSH_COMMAND: ${gitSshCommand}`)

    await this.initializeCostrictBinDirectory()

    let stderrOutput = ''

    this.serverProcess = spawn(
      'cs',
      ['serve', '--port', COSTRICT_SERVER_PORT.toString(), '--hostname', COSTRICT_SERVER_HOST],
      {
        cwd: costrictServerDirectory,
        detached: !isDevelopment,
        stdio: isDevelopment ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...gitEnv,
          ...gitIdentityEnv,
          GIT_SSH_COMMAND: gitSshCommand,
          XDG_DATA_HOME: path.join(costrictServerDirectory, '.costrict/state'),
          XDG_CONFIG_HOME: path.join(costrictServerDirectory, '.config'),
          COSTRICT_CONFIG: costrictConfigPath,
        }
      }
    )

    if (!isDevelopment && this.serverProcess.stderr) {
      this.serverProcess.stderr.on('data', (data) => {
        stderrOutput += data.toString()
        if (stderrOutput.length > MAX_STDERR_SIZE) {
          stderrOutput = stderrOutput.slice(-MAX_STDERR_SIZE)
        }
      })
    }

    this.serverProcess.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        this.lastStartupError = `Server exited with code ${code}${stderrOutput ? `: ${stderrOutput.slice(-500)}` : ''}`
        logger.error('CoStrict server process exited:', this.lastStartupError)
      } else if (signal) {
        this.lastStartupError = `Server terminated by signal ${signal}`
        logger.error('CoStrict server process terminated:', this.lastStartupError)
      }
    })

    this.serverPid = this.serverProcess.pid ?? null

    logger.info(`CoStrict server started with PID ${this.serverPid}`)

    logger.info('Waiting for CoStrict server to become healthy...')
    const healthy = await this.waitForHealth(30000)
    if (!healthy) {
      this.lastStartupError = `Server failed to become healthy after 30s${stderrOutput ? `. Last error: ${stderrOutput.slice(-500)}` : ''}`
      throw new Error('CoStrict server failed to become healthy')
    }

    this.isHealthy = true
    logger.info('CoStrict server is healthy')

    await this.fetchVersion()
    if (this.version) {
      logger.info(`CoStrict version: ${this.version}`)
      if (!this.isVersionSupported()) {
        logger.warn(`CoStrict version ${this.version} is below minimum required version ${MIN_COSTRICT_VERSION}`)
        logger.warn('Some features like MCP management may not work correctly')
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.serverPid) return

    logger.info('Stopping CoStrict server')
    try {
      process.kill(this.serverPid, 'SIGTERM')
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
      if (errorCode === 'ESRCH') {
        logger.debug(`Process ${this.serverPid} already stopped`)
      } else {
        logger.warn(`Failed to send SIGTERM to ${this.serverPid}:`, error)
      }
    }

    await new Promise(r => setTimeout(r, 2000))

    try {
      process.kill(this.serverPid, 'SIGKILL')
    } catch (error) {
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : ''
      if (errorCode === 'ESRCH') {
        logger.debug(`Process ${this.serverPid} already stopped`)
      } else {
        logger.warn(`Failed to send SIGKILL to ${this.serverPid}:`, error)
      }
    }

    this.serverPid = null
    this.isHealthy = false

    try {
      await cleanupPersistentSSHKeys()
    } catch (error) {
      logger.warn('Failed to cleanup persistent SSH keys:', error)
    }
  }

  private async initializeCostrictBinDirectory(): Promise<void> {
    const binDir = path.join(
      getCoStrictServerDirectory(),
      '.costrict',
      'state',
      'costrict',
      'bin'
    )

    const packageJsonPath = path.join(binDir, 'package.json')

    try {
      await fs.mkdir(binDir, { recursive: true })

      const packageJsonExists = await fs.access(packageJsonPath)
        .then(() => true)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return false
          throw error
        })

      if (!packageJsonExists) {
        try {
          execSync('bun init -y', {
            cwd: binDir,
            stdio: 'inherit',
            timeout: 30000
          })
          logger.info('CoStrict bin directory initialized successfully')
        } catch (error) {
          logger.error('bun init failed:', error)
          throw new Error(`bun init failed: ${error}`)
        }
      }

    } catch (error) {
      logger.error('Failed to initialize CoStrict bin directory:', error)
    }
  }

  async restart(): Promise<void> {
    logger.info('Restarting CoStrict server (full process restart)')
    await this.stop()
    await new Promise(r => setTimeout(r, 1000))
    await this.start()
  }

  async reloadConfig(): Promise<void> {
    logger.info('Reloading CoStrict configuration (via API)')
    try {
      const response = await fetch(`http://${COSTRICT_SERVER_HOST}:${COSTRICT_SERVER_PORT}/config`, {
        method: 'GET'
      })

      if (!response.ok) {
        throw new Error(`Failed to get current config: ${response.status}`)
      }

      const currentConfig = await response.json()
      logger.info('Triggering CoStrict config reload via PATCH')
      const patchResponse = await fetch(`http://${COSTRICT_SERVER_HOST}:${COSTRICT_SERVER_PORT}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentConfig)
      })

      if (!patchResponse.ok) {
        throw new Error(`Failed to reload config: ${patchResponse.status}`)
      }

      logger.info('CoStrict configuration reloaded successfully')
      await new Promise(r => setTimeout(r, 500))
      const healthy = await this.checkHealth()
      if (!healthy) {
        throw new Error('Server unhealthy after config reload')
      }
    } catch (error) {
      logger.error('Failed to reload CoStrict config:', error)
      throw error
    }
  }

  getPort(): number {
    return COSTRICT_SERVER_PORT
  }

  getVersion(): string | null {
    return this.version
  }

  getMinVersion(): string {
    return MIN_COSTRICT_VERSION
  }

  isVersionSupported(): boolean {
    if (!this.version) return false
    return compareVersions(this.version, MIN_COSTRICT_VERSION) >= 0
  }

  getLastStartupError(): string | null {
    return this.lastStartupError
  }

  clearStartupError(): void {
    this.lastStartupError = null
  }

  async reinitializeBinDirectory(): Promise<void> {
    logger.info('Reinitializing CoStrict bin directory')
    await this.initializeCostrictBinDirectory()
  }

  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`http://${COSTRICT_SERVER_HOST}:${COSTRICT_SERVER_PORT}/doc`, {
        signal: AbortSignal.timeout(3000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  async fetchVersion(): Promise<string | null> {
    try {
      const result = execSync('cs --version 2>&1', { encoding: 'utf8' })
      const match = result.match(/(\d+\.\d+\.\d+)/)
      if (match && match[1]) {
        this.version = match[1]
        return this.version
      }
    } catch (error) {
      logger.warn('Failed to get CoStrict version:', error)
    }
    return null
  }

  private async waitForHealth(timeoutMs: number): Promise<boolean> {
    const start = Date.now()
    let attempts = 0
    while (Date.now() - start < timeoutMs) {
      attempts++
      try {
        const isHealthy = await this.checkHealth()
        if (isHealthy) {
          logger.info(`CoStrict server health check passed (attempt ${attempts})`)
          return true
        }
      } catch (error) {
        logger.debug(`Health check attempt ${attempts} failed:`, error)
      }
      await new Promise(r => setTimeout(r, 500))
    }
    logger.warn(`CoStrict server health check failed after ${attempts} attempts`)
    return false
  }

  private async findProcessesByPort(port: number): Promise<Array<{pid: number}>> {
    try {
      let command: string
      if (process.platform === 'win32') {
        // Windows: use netstat
        command = `netstat -ano | findstr :${port} | findstr LISTENING`
      } else {
        // Unix-like: use lsof
        command = `lsof -ti:${port}`
      }

      const output = execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

      if (process.platform === 'win32') {
        // Parse netstat output: "TCP    0.0.0.0:5551    0.0.0.0:0    LISTENING    12345"
        const lines = output.trim().split('\n')
        const pids = new Set<number>()
        for (const line of lines) {
          const parts = line.trim().split(/\s+/)
          const pid = parts[parts.length - 1]
          if (pid && /^\d+$/.test(pid)) {
            pids.add(parseInt(pid))
          }
        }
        return Array.from(pids).map(pid => ({ pid }))
      } else {
        // Parse lsof output: just PIDs separated by newlines
        const pids = output.trim().split('\n')
        return pids.filter(Boolean).map(pid => ({ pid: parseInt(pid) }))
      }
    } catch {
      return []
    }
  }
}

export const costrictServerManager = CoStrictServerManager.getInstance()
export { CoStrictServerManager }
