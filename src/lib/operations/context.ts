/**
 * Shared Operation Context
 *
 * Provides a unified context for all interfaces (CLI, RPC, MCP)
 * to share state and configuration.
 */

import type { XanoLocalConfig } from '../types.js'

import { getProfile, XanoApi } from '../api.js'
import { findProjectRoot, loadEffectiveConfig } from '../project.js'

/**
 * Shared context for operations across all interfaces
 */
export interface OperationContext {
  api: null | XanoApi
  config: null | XanoLocalConfig
  datasource?: string
  profileName?: string
  projectRoot: null | string
  tableIdCache: Map<string, number>
}

/**
 * Options for creating a new operation context
 */
export interface CreateContextOptions {
  datasource?: string
  profileName?: string
  projectRoot?: string
}

/**
 * Resolve project root from options, environment, or auto-detection
 *
 * Priority:
 * 1. Explicit option
 * 2. XANO_PROJECT_ROOT environment variable
 * 3. Auto-detect via findProjectRoot()
 */
function resolveProjectRoot(explicitRoot?: string): null | string {
  if (explicitRoot) {
    return explicitRoot
  }

  const envRoot = process.env.XANO_PROJECT_ROOT
  if (envRoot) {
    return envRoot
  }

  return findProjectRoot()
}

/**
 * Create a new operation context
 *
 * Initializes the context with project config, profile, and API client.
 * Can optionally override profile and datasource.
 *
 * Project root is resolved in this order:
 * 1. options.projectRoot (explicit)
 * 2. XANO_PROJECT_ROOT environment variable
 * 3. Auto-detect via findProjectRoot() (walks up from cwd)
 */
export function createContext(options: CreateContextOptions = {}): OperationContext {
  const projectRoot = resolveProjectRoot(options.projectRoot)
  const config = projectRoot ? loadEffectiveConfig(projectRoot) : null

  const profileName = options.profileName ?? config?.profile
  const profile = getProfile(profileName, config?.profile)
  const api = profile && config ? new XanoApi(profile, config.workspaceId, config.branch) : null

  return {
    api,
    config,
    datasource: options.datasource ?? config?.defaultDatasource,
    profileName,
    projectRoot,
    tableIdCache: new Map(),
  }
}

/**
 * Reinitialize the API client in a context
 *
 * Call this after changing profileName to update the API client.
 */
export function reinitializeApi(ctx: OperationContext): void {
  const profile = getProfile(ctx.profileName, ctx.config?.profile)
  ctx.api = profile && ctx.config
    ? new XanoApi(profile, ctx.config.workspaceId, ctx.config.branch)
    : null
}

/**
 * Update context configuration
 *
 * Allows changing profile and/or datasource at runtime.
 */
export function updateContext(
  ctx: OperationContext,
  updates: { datasource?: string; profileName?: string }
): void {
  if (updates.profileName !== undefined) {
    ctx.profileName = updates.profileName || undefined
    reinitializeApi(ctx)
  }

  if (updates.datasource !== undefined) {
    ctx.datasource = updates.datasource || undefined
  }
}

/**
 * Get current context configuration summary
 */
export function getContextConfig(ctx: OperationContext): {
  branch?: string
  datasource?: string
  profile?: string
  workspace?: string
} {
  return {
    branch: ctx.config?.branch,
    datasource: ctx.datasource,
    profile: ctx.profileName,
    workspace: ctx.config?.workspaceName,
  }
}
