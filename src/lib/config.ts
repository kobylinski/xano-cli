/**
 * Configuration loader supporting xano.js and xano.json
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import type {
  PathResolver,
  SanitizeFunction,
  TypeResolver,
  XanoPaths,
  XanoProjectConfig,
} from './types.js'
import { getDefaultPaths } from './project.js'

export interface LoadedConfig {
  config: XanoProjectConfig
  resolvePath?: PathResolver
  resolveType?: TypeResolver
  sanitize?: SanitizeFunction
}

/**
 * Load xano.js or xano.json from a directory
 * Priority: xano.js > xano.json
 */
export async function loadConfig(projectRoot: string): Promise<LoadedConfig | null> {
  const jsPath = path.join(projectRoot, 'xano.js')
  const jsonPath = path.join(projectRoot, 'xano.json')

  // Try xano.js first
  if (fs.existsSync(jsPath)) {
    return loadJsConfig(jsPath)
  }

  // Fall back to xano.json
  if (fs.existsSync(jsonPath)) {
    return loadJsonConfig(jsonPath)
  }

  return null
}

/**
 * Load xano.js (dynamic config with optional resolvePath/sanitize)
 */
async function loadJsConfig(filePath: string): Promise<LoadedConfig | null> {
  try {
    // Use dynamic import for ES modules
    const fileUrl = pathToFileURL(filePath).href
    const module = await import(fileUrl)
    const exported = module.default || module

    // Validate required fields
    if (!exported.instance || !exported.workspaceId) {
      throw new Error('xano.js must export instance and workspaceId')
    }

    const config: XanoProjectConfig = {
      instance: exported.instance,
      paths: {
        ...getDefaultPaths(),
        ...exported.paths,
      },
      workspace: exported.workspace || '',
      workspaceId: exported.workspaceId,
    }

    return {
      config,
      resolvePath: typeof exported.resolvePath === 'function' ? exported.resolvePath : undefined,
      resolveType: typeof exported.resolveType === 'function' ? exported.resolveType : undefined,
      sanitize: typeof exported.sanitize === 'function' ? exported.sanitize : undefined,
    }
  } catch (error) {
    console.error(`Error loading xano.js: ${error}`)
    return null
  }
}

/**
 * Load xano.json (static config only)
 */
function loadJsonConfig(filePath: string): LoadedConfig | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(content) as XanoProjectConfig

    // Validate required fields
    if (!parsed.instance || !parsed.workspaceId) {
      throw new Error('xano.json must contain instance and workspaceId')
    }

    const config: XanoProjectConfig = {
      instance: parsed.instance,
      paths: {
        ...getDefaultPaths(),
        ...parsed.paths,
      },
      workspace: parsed.workspace || '',
      workspaceId: parsed.workspaceId,
    }

    return {
      config,
    }
  } catch (error) {
    console.error(`Error loading xano.json: ${error}`)
    return null
  }
}

/**
 * Save config to xano.json
 */
export function saveConfig(projectRoot: string, config: XanoProjectConfig): void {
  const filePath = path.join(projectRoot, 'xano.json')
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8')
}

/**
 * Check if config file exists (xano.js or xano.json)
 */
export function hasConfig(projectRoot: string): boolean {
  const jsPath = path.join(projectRoot, 'xano.js')
  const jsonPath = path.join(projectRoot, 'xano.json')
  return fs.existsSync(jsPath) || fs.existsSync(jsonPath)
}

/**
 * Get config file path that exists
 */
export function getConfigPath(projectRoot: string): string | null {
  const jsPath = path.join(projectRoot, 'xano.js')
  const jsonPath = path.join(projectRoot, 'xano.json')

  if (fs.existsSync(jsPath)) return jsPath
  if (fs.existsSync(jsonPath)) return jsonPath
  return null
}
