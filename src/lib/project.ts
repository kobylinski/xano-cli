/**
 * Project configuration management
 * Handles xano.json (versioned) and .xano/config.json (local)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { XanoLocalConfig, XanoPaths, XanoProjectConfig } from './types.js'

const XANO_JS = 'xano.js'
const XANO_JSON = 'xano.json'
const XANO_DIR = '.xano'
const CONFIG_JSON = 'config.json'

/**
 * Find project root by looking for .xano/config.json (primary) or xano.js/xano.json (fallback)
 */
export function findProjectRoot(startDir: string = process.cwd()): null | string {
  let currentDir = startDir

  while (currentDir !== dirname(currentDir)) {
    // Primary: look for .xano/config.json
    const configJsonPath = join(currentDir, XANO_DIR, CONFIG_JSON)
    if (existsSync(configJsonPath)) {
      return currentDir
    }

    // Fallback: look for xano.js (dynamic config)
    const xanoJsPath = join(currentDir, XANO_JS)
    if (existsSync(xanoJsPath)) {
      return currentDir
    }

    // Fallback: look for xano.json (static config)
    const xanoJsonPath = join(currentDir, XANO_JSON)
    if (existsSync(xanoJsonPath)) {
      return currentDir
    }

    currentDir = dirname(currentDir)
  }

  return null
}

/**
 * Check if current directory is a xano project
 */
export function isXanoProject(dir: string = process.cwd()): boolean {
  return findProjectRoot(dir) !== null
}

/**
 * Get path to xano.json
 */
export function getXanoJsonPath(projectRoot: string): string {
  return join(projectRoot, XANO_JSON)
}

/**
 * Get path to .xano directory
 */
export function getXanoDirPath(projectRoot: string): string {
  return join(projectRoot, XANO_DIR)
}

/**
 * Get path to .xano/config.json
 */
export function getConfigJsonPath(projectRoot: string): string {
  return join(projectRoot, XANO_DIR, CONFIG_JSON)
}

/**
 * Load xano.json (versioned project config)
 */
export function loadXanoJson(projectRoot: string): null | XanoProjectConfig {
  const filePath = getXanoJsonPath(projectRoot)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, 'utf8')
    return JSON.parse(content) as XanoProjectConfig
  } catch {
    return null
  }
}

/**
 * Save xano.json (versioned project config)
 */
export function saveXanoJson(projectRoot: string, config: XanoProjectConfig): void {
  const filePath = getXanoJsonPath(projectRoot)
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

/**
 * Ensure .xano directory exists
 */
export function ensureXanoDir(projectRoot: string): string {
  const xanoDir = getXanoDirPath(projectRoot)

  if (!existsSync(xanoDir)) {
    mkdirSync(xanoDir, { recursive: true })
  }

  return xanoDir
}

/**
 * Load .xano/config.json (local config, VSCode compatible)
 * Normalizes paths from either CLI or VSCode format to canonical CLI format
 */
export function loadLocalConfig(projectRoot: string): null | XanoLocalConfig {
  const filePath = getConfigJsonPath(projectRoot)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(content) as XanoLocalConfig

    // Normalize paths to canonical CLI format (handles VSCode camelCase keys)
    if (parsed.paths) {
      parsed.paths = normalizePaths(parsed.paths)
    }

    return parsed
  } catch {
    return null
  }
}

/**
 * Save .xano/config.json (local config, VSCode compatible)
 * Uses VSCode extension's camelCase naming convention
 */
export function saveLocalConfig(projectRoot: string, config: XanoLocalConfig): void {
  ensureXanoDir(projectRoot)
  const filePath = getConfigJsonPath(projectRoot)
  writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf8')
}

/**
 * Create local config from project config + branch
 */
export function createLocalConfig(
  projectConfig: XanoProjectConfig,
  branch: string
): XanoLocalConfig {
  return {
    branch,
    ...(projectConfig.datasources && { datasources: projectConfig.datasources }),
    ...(projectConfig.defaultDatasource && { defaultDatasource: projectConfig.defaultDatasource }),
    instanceName: projectConfig.instance,
    ...(projectConfig.naming && { naming: projectConfig.naming }),
    paths: { ...projectConfig.paths },
    ...(projectConfig.profile && { profile: projectConfig.profile }),
    workspaceId: projectConfig.workspaceId,
    workspaceName: projectConfig.workspace,
  }
}

/**
 * Check if .xano/config.json exists (project is initialized)
 */
export function isInitialized(projectRoot: string): boolean {
  return existsSync(getConfigJsonPath(projectRoot))
}

/**
 * Get current branch from local config
 */
export function getCurrentBranch(projectRoot: string): null | string {
  const config = loadLocalConfig(projectRoot)
  return config?.branch ?? null
}

/**
 * Set current branch in local config
 */
export function setCurrentBranch(projectRoot: string, branch: string): void {
  const config = loadLocalConfig(projectRoot)
  if (config) {
    config.branch = branch
    saveLocalConfig(projectRoot, config)
  }
}

/**
 * Get default paths for XanoScript files
 * Uses VSCode extension's camelCase naming convention
 */
export function getDefaultPaths(): XanoPaths {
  return {
    addOns: 'addons',
    agents: 'agents',
    agentTriggers: 'agents/triggers',
    apis: 'apis',
    functions: 'functions',
    mcpServers: 'mcp_servers',
    mcpServerTriggers: 'mcp_servers/triggers',
    middlewares: 'middlewares',
    realtimeChannels: 'realtime',
    realtimeTriggers: 'realtime/triggers',
    tables: 'tables',
    tableTriggers: 'tables/triggers',
    tasks: 'tasks',
    tools: 'tools',
    workflowTests: 'workflow_tests',
  }
}

/**
 * Mapping from legacy snake_case keys to VSCode camelCase keys
 * For backwards compatibility with older xano.json files
 */
const LEGACY_KEY_MAPPING: Record<string, string> = {
  addons: 'addOns',
  triggers: 'tableTriggers',
  workflow_tests: 'workflowTests', // eslint-disable-line camelcase
}

/**
 * Normalize paths to VSCode's camelCase format
 * Handles legacy snake_case keys for backwards compatibility
 */
export function normalizePaths(paths: Record<string, string | undefined>): XanoPaths {
  const defaults = getDefaultPaths()
  const normalized: XanoPaths = { ...defaults }

  for (const [key, value] of Object.entries(paths)) {
    if (value === undefined) continue

    // Convert legacy snake_case keys to camelCase
    const normalizedKey = LEGACY_KEY_MAPPING[key] || key
    normalized[normalizedKey] = value
  }

  return normalized
}
