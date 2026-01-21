/**
 * Datasource permission validation
 * Prevents destructive operations on protected datasources
 */

import type { DatasourceAccessLevel, DatasourcePermissions } from './types.js'

// Operation types for permission checking
export type DatasourceOperation = 'read' | 'write'

// Default access level when datasource is not configured
const DEFAULT_ACCESS_LEVEL: DatasourceAccessLevel = 'read-only'

/**
 * Get access level for a datasource
 * Returns 'read-only' for unconfigured datasources (safe default)
 */
export function getDatasourceAccessLevel(
  datasource: string | undefined,
  permissions: DatasourcePermissions | undefined
): DatasourceAccessLevel {
  // No datasource specified - using default datasource (typically 'live')
  // Default datasource follows the same rules
  if (!datasource) {
    // When no datasource flag is passed, Xano uses 'live' by default
    return permissions?.live ?? DEFAULT_ACCESS_LEVEL
  }

  // Return configured level or default
  return permissions?.[datasource] ?? DEFAULT_ACCESS_LEVEL
}

/**
 * Check if an operation is allowed for a datasource
 */
export function isOperationAllowed(
  datasource: string | undefined,
  operation: DatasourceOperation,
  permissions: DatasourcePermissions | undefined
): boolean {
  const accessLevel = getDatasourceAccessLevel(datasource, permissions)

  switch (accessLevel) {
    case 'locked': {
      return false
    }

    case 'read-only': {
      return operation === 'read'
    }

    case 'read-write': {
      return true
    }

    default: {
      return false
    }
  }
}

/**
 * Error class for datasource permission errors
 */
export class DatasourcePermissionError extends Error {
  constructor(
    public readonly datasource: string | undefined,
    public readonly operation: DatasourceOperation,
    public readonly accessLevel: DatasourceAccessLevel
  ) {
    const dsName = datasource || 'live (default)'
    const message = accessLevel === 'locked'
      ? `Datasource '${dsName}' is locked. No operations are allowed.`
      : `Datasource '${dsName}' is read-only. Write operations are not allowed.`

    super(message)
    this.name = 'DatasourcePermissionError'
  }
}

/**
 * Check datasource permission and throw if not allowed
 * Use this in commands before performing operations
 *
 * @param datasource - The datasource label (undefined = default/live)
 * @param operation - 'read' or 'write'
 * @param permissions - Datasource permissions from config
 * @throws DatasourcePermissionError if operation not allowed
 */
export function checkDatasourcePermission(
  datasource: string | undefined,
  operation: DatasourceOperation,
  permissions: DatasourcePermissions | undefined
): void {
  if (!isOperationAllowed(datasource, operation, permissions)) {
    const accessLevel = getDatasourceAccessLevel(datasource, permissions)
    throw new DatasourcePermissionError(datasource, operation, accessLevel)
  }
}

/**
 * Format datasource name for display
 */
export function formatDatasourceName(datasource: string | undefined): string {
  return datasource || 'live (default)'
}

/**
 * Resolve effective datasource based on flag, config default, and agent mode
 *
 * Priority:
 * 1. In agent mode: ONLY use config default (flag override is blocked)
 * 2. In human mode: flag > config default > undefined (Xano default)
 *
 * @param flagValue - Value from --datasource flag
 * @param configDefault - Default from config.defaultDatasource
 * @param agentMode - Whether running in agent mode
 * @returns Object with resolved datasource and whether agent was blocked
 */
export function resolveEffectiveDatasource(
  flagValue: string | undefined,
  configDefault: string | undefined,
  agentMode: boolean
): { blocked: boolean; datasource: string | undefined } {
  // Agent mode: block flag override, use config default only
  if (agentMode) {
    if (flagValue && flagValue !== configDefault) {
      return {
        blocked: true,
        datasource: configDefault,
      }
    }

    return {
      blocked: false,
      datasource: configDefault,
    }
  }

  // Human mode: flag takes precedence, then config default
  return {
    blocked: false,
    datasource: flagValue ?? configDefault,
  }
}

/**
 * Format agent blocked message for datasource override attempt
 */
export function formatAgentDatasourceBlockedMessage(
  attemptedDatasource: string,
  effectiveDatasource: string = 'live (Xano default)'
): string {
  return [
    'AGENT_WARNING: datasource_override_blocked',
    `AGENT_ATTEMPTED: ${attemptedDatasource}`,
    `AGENT_EFFECTIVE: ${effectiveDatasource}`,
    'AGENT_MESSAGE: Agents cannot override the --datasource flag. Using configured default.',
    'AGENT_HINT: Ask the human to change the default datasource using: xano datasource:default <name>',
  ].join('\n')
}

/**
 * Get human-readable description of access level
 */
export function describeAccessLevel(level: DatasourceAccessLevel): string {
  switch (level) {
    case 'locked': {
      return 'no access'
    }

    case 'read-only': {
      return 'read-only access'
    }

    case 'read-write': {
      return 'full read-write access'
    }

    default: {
      return 'unknown access'
    }
  }
}
