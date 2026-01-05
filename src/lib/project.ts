/**
 * Project configuration management
 * Handles xano.json (versioned) and .xano/config.json (local)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { XanoLocalConfig, XanoProjectConfig } from './types.js'

const XANO_JSON = 'xano.json'
const XANO_DIR = '.xano'
const CONFIG_JSON = 'config.json'

/**
 * Find project root by looking for .xano/config.json (primary) or xano.json (fallback)
 */
export function findProjectRoot(startDir: string = process.cwd()): null | string {
  let currentDir = startDir

  while (currentDir !== path.dirname(currentDir)) {
    // Primary: look for .xano/config.json
    const configJsonPath = path.join(currentDir, XANO_DIR, CONFIG_JSON)
    if (fs.existsSync(configJsonPath)) {
      return currentDir
    }

    // Fallback: look for xano.json (template file)
    const xanoJsonPath = path.join(currentDir, XANO_JSON)
    if (fs.existsSync(xanoJsonPath)) {
      return currentDir
    }

    currentDir = path.dirname(currentDir)
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
  return path.join(projectRoot, XANO_JSON)
}

/**
 * Get path to .xano directory
 */
export function getXanoDirPath(projectRoot: string): string {
  return path.join(projectRoot, XANO_DIR)
}

/**
 * Get path to .xano/config.json
 */
export function getConfigJsonPath(projectRoot: string): string {
  return path.join(projectRoot, XANO_DIR, CONFIG_JSON)
}

/**
 * Load xano.json (versioned project config)
 */
export function loadXanoJson(projectRoot: string): null | XanoProjectConfig {
  const filePath = getXanoJsonPath(projectRoot)

  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8')
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
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

/**
 * Ensure .xano directory exists
 */
export function ensureXanoDir(projectRoot: string): string {
  const xanoDir = getXanoDirPath(projectRoot)

  if (!fs.existsSync(xanoDir)) {
    fs.mkdirSync(xanoDir, { recursive: true })
  }

  return xanoDir
}

/**
 * Load .xano/config.json (local config, VSCode compatible)
 */
export function loadLocalConfig(projectRoot: string): null | XanoLocalConfig {
  const filePath = getConfigJsonPath(projectRoot)

  if (!fs.existsSync(filePath)) {
    return null
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(content) as XanoLocalConfig
  } catch {
    return null
  }
}

/**
 * Save .xano/config.json (local config, VSCode compatible)
 */
export function saveLocalConfig(projectRoot: string, config: XanoLocalConfig): void {
  ensureXanoDir(projectRoot)
  const filePath = getConfigJsonPath(projectRoot)
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
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
    instanceName: projectConfig.instance,
    paths: { ...projectConfig.paths },
    workspaceId: projectConfig.workspaceId,
    workspaceName: projectConfig.workspace,
  }
}

/**
 * Check if .xano/config.json exists (project is initialized)
 */
export function isInitialized(projectRoot: string): boolean {
  return fs.existsSync(getConfigJsonPath(projectRoot))
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
 */
export function getDefaultPaths(): XanoProjectConfig['paths'] {
  return {
    apis: 'apis',
    functions: 'functions',
    tables: 'tables',
    tasks: 'tasks',
  }
}
