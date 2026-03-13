import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { readFile } from 'fs/promises'
import { costrictServerManager } from '../services/costrict-server'
import { compareVersions } from '../utils/version-utils'

const GITHUB_REPO_OWNER = 'chriswritescode-dev'
const GITHUB_REPO_NAME = 'costrict-manager'

interface CachedRelease {
  tagName: string
  htmlUrl: string
  name: string
  fetchedAt: number
}

let cachedRelease: CachedRelease | null = null
const CACHE_TTL_MS = 60 * 60 * 1000

async function fetchLatestRelease(): Promise<CachedRelease | null> {
  if (cachedRelease && Date.now() - cachedRelease.fetchedAt < CACHE_TTL_MS) {
    return cachedRelease
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`,
      {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'CoStrict-Manager'
        }
      }
    )

    if (!response.ok) {
      return cachedRelease
    }

    const data = await response.json() as { tag_name?: string; html_url?: string; name?: string }
    const tagName = data.tag_name ?? '0.0.0'
    const htmlUrl = data.html_url ?? ''
    const name = data.name ?? tagName

    cachedRelease = {
      tagName,
      htmlUrl,
      name,
      fetchedAt: Date.now()
    }

    return cachedRelease
  } catch {
    return cachedRelease
  }
}

const costrictManagerVersionPromise = (async (): Promise<string | null> => {
  try {
    const packageUrl = new URL('../../../package.json', import.meta.url)
    const packageJsonRaw = await readFile(packageUrl, 'utf-8')
    const packageJson = JSON.parse(packageJsonRaw) as { version?: unknown }
    return typeof packageJson.version === 'string' ? packageJson.version : null
  } catch {
    return null
  }
})()

export function createHealthRoutes(db: Database) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const costrictManagerVersion = await costrictManagerVersionPromise
      const dbCheck = db.prepare('SELECT 1').get()
      const costrictHealthy = await costrictServerManager.checkHealth()
      const startupError = costrictServerManager.getLastStartupError()

      const status = startupError && !costrictHealthy
        ? 'unhealthy'
        : (dbCheck && costrictHealthy ? 'healthy' : 'degraded')

      const response: Record<string, unknown> = {
        status,
        timestamp: new Date().toISOString(),
        database: dbCheck ? 'connected' : 'disconnected',
        costrict: costrictHealthy ? 'healthy' : 'unhealthy',
        costrictPort: costrictServerManager.getPort(),
        costrictVersion: costrictServerManager.getVersion(),
        costrictMinVersion: costrictServerManager.getMinVersion(),
        costrictVersionSupported: costrictServerManager.isVersionSupported(),
        costrictManagerVersion,
      }

      if (startupError && !costrictHealthy) {
        response.error = startupError
      }

      return c.json(response)
    } catch (error) {
      const costrictManagerVersion = await costrictManagerVersionPromise
      return c.json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        costrictManagerVersion,
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 503)
    }
  })

  app.get('/processes', async (c) => {
    try {
      const opencodeHealthy = await costrictServerManager.checkHealth()
      
      return c.json({
        opencode: {
          port: costrictServerManager.getPort(),
          healthy: opencodeHealthy
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }, 500)
    }
  })

  app.get('/version', async (c) => {
    const currentVersion = await costrictManagerVersionPromise
    const latestRelease = await fetchLatestRelease()

    if (!currentVersion) {
      return c.json({
        currentVersion: null,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseName: null
      })
    }

    if (!latestRelease) {
      return c.json({
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        releaseUrl: null,
        releaseName: null
      })
    }

    const latestVersion = latestRelease.tagName.replace(/^v/, '')
    const isUpdateAvailable = compareVersions(currentVersion, latestVersion) < 0

    return c.json({
      currentVersion,
      latestVersion,
      updateAvailable: isUpdateAvailable,
      releaseUrl: latestRelease.htmlUrl,
      releaseName: latestRelease.name
    })
  })

  return app
}
