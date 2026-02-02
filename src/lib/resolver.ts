/**
 * Type resolution for CLI input paths
 * Resolves user input to XanoObjectTypes based on paths config
 */

import { basename , isAbsolute, relative } from 'node:path'

import type {
  TypeResolver,
  XanoObjectType,
  XanoPaths,
} from './types.js'

import { findObjectsByType, loadObjects } from './objects.js'

/**
 * Result of local table resolution
 */
export interface LocalTableResult {
  id: number
  name: string
}

/**
 * Options for table resolution
 */
export interface ResolveTableOptions {
  /** Agent mode - provide structured output for AI agents */
  agentMode?: boolean
  /** Use remote API instead of local objects.json */
  remote?: boolean
}

/**
 * Extract table name from objects.json path
 * Path format: "tables/orders.xs" → "orders"
 */
function extractTableNameFromPath(path: string): string {
  const filename = basename(path, '.xs')
  // Handle VSCode ID prefix format: "123_orders.xs" → "orders"
  const idPrefixMatch = filename.match(/^\d+_(.+)$/)
  return idPrefixMatch ? idPrefixMatch[1] : filename
}

/**
 * Resolve table name to ID using local objects.json
 * Returns null if not found locally
 */
export function resolveTableFromLocal(
  projectRoot: string,
  tableRef: string
): LocalTableResult | null {
  // If it's already a number, return it directly
  const numId = Number.parseInt(tableRef, 10)
  if (!Number.isNaN(numId)) {
    return { id: numId, name: tableRef }
  }

  // Load objects.json and find table by name
  const objects = loadObjects(projectRoot)
  const tables = findObjectsByType(objects, 'table')

  const lowerRef = tableRef.toLowerCase()

  for (const table of tables) {
    const tableName = extractTableNameFromPath(table.path)
    if (tableName.toLowerCase() === lowerRef) {
      return { id: table.id, name: tableName }
    }
  }

  return null
}

/**
 * Get all tables from local objects.json
 * Useful for suggestions when table not found
 */
export function getLocalTables(projectRoot: string): LocalTableResult[] {
  const objects = loadObjects(projectRoot)
  const tables = findObjectsByType(objects, 'table')

  return tables.map(table => ({
    id: table.id,
    name: extractTableNameFromPath(table.path),
  }))
}

/**
 * Format error message when table not found
 * @param tableRef - The table reference that was not found
 * @param agentMode - Whether to format for AI agent consumption
 * @param usedRemote - Whether --remote flag was used (changes the error message)
 */
export function formatTableNotFoundError(
  tableRef: string,
  agentMode?: boolean,
  usedRemote?: boolean
): string {
  if (usedRemote) {
    // Table not found on remote Xano server
    if (agentMode) {
      return [
        `AGENT_ERROR: table_not_found`,
        `AGENT_TABLE: ${tableRef}`,
        `AGENT_MESSAGE: Table "${tableRef}" not found on Xano server.`,
        `AGENT_ACTION: Verify the table name is correct. The table may have been deleted or renamed.`,
        `AGENT_SUGGESTION: Run "xano pull --sync" to see available tables.`,
      ].join('\n')
    }

    return `Table "${tableRef}" not found on Xano server.\n` +
      `The table may have been deleted or renamed. Run "xano pull --sync" to see available tables.`
  }

  // Table not found in local cache
  if (agentMode) {
    return [
      `AGENT_ERROR: table_not_found`,
      `AGENT_TABLE: ${tableRef}`,
      `AGENT_MESSAGE: Table "${tableRef}" not found in local cache (.xano/objects.json).`,
      `AGENT_ACTION: Run "xano pull --sync" to refresh local metadata from Xano.`,
      `AGENT_ALTERNATIVE: Use --remote flag to query Xano directly: xano data:list ${tableRef} --remote`,
    ].join('\n')
  }

  return `Table "${tableRef}" not found in local cache.\n` +
    `Run "xano pull --sync" to refresh metadata from Xano, or use --remote flag to query directly.`
}

/**
 * Map paths config key to XanoObjectType(s)
 * Uses VSCode extension's camelCase naming convention
 */
function getTypesForPathKey(key: string): null | XanoObjectType[] {
  switch (key) {
    case 'addOns': { return ['addon']
    }

    case 'apis': { return ['api_endpoint', 'api_group']
    }

    case 'functions': { return ['function']
    }

    case 'middlewares': { return ['middleware']
    }

    case 'tables': { return ['table']
    }

    case 'tableTriggers': { return ['table_trigger']
    }

    case 'tasks': { return ['task']
    }

    case 'workflowTests': { return ['workflow_test']
    }

    default: { return null
    }
  }
}

/**
 * Get all path keys that match the input path
 * Returns the matched key AND all keys whose paths are nested under the input
 */
function getMatchingPathKeys(inputPath: string, paths: XanoPaths): string[] {
  const entries = Object.entries(paths)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')

  const matchedKeys: string[] = []

  for (const [key, basePath] of entries) {
    // Check if input matches this path (input is same or inside basePath)
    const relToBase = relative(basePath, inputPath)
    const inputMatchesBase = relToBase === '' || (!relToBase.startsWith('..') && !isAbsolute(relToBase))

    // Check if this path is nested under input (basePath is same or inside input)
    const relToInput = relative(inputPath, basePath)
    const baseIsUnderInput = relToInput === '' || (!relToInput.startsWith('..') && !isAbsolute(relToInput))

    if (inputMatchesBase || baseIsUnderInput) {
      matchedKeys.push(key)
    }
  }

  return matchedKeys
}

/**
 * Resolve input path to object types
 *
 * Priority:
 * 1. Dynamic resolver (xano.js resolveType function) - if provided
 * 2. Match against configured paths using relative
 *
 * Returns types for matched path AND all nested paths under it
 */
export function resolveInputToTypes(
  inputPath: string,
  paths: XanoPaths,
  dynamicResolver?: TypeResolver
): null | XanoObjectType[] {
  // Normalize input - remove trailing slash
  const normalized = inputPath.replace(/\/$/, '')

  // 1. Try dynamic resolver first (highest priority)
  if (dynamicResolver) {
    const result = dynamicResolver(normalized, paths)
    if (result && result.length > 0) {
      return result
    }
  }

  // 2. Match against configured paths
  const matchedKeys = getMatchingPathKeys(normalized, paths)

  if (matchedKeys.length === 0) {
    return null
  }

  // Collect all types for matched keys
  const types: XanoObjectType[] = []
  for (const key of matchedKeys) {
    const keyTypes = getTypesForPathKey(key)
    if (keyTypes) {
      for (const t of keyTypes) {
        if (!types.includes(t)) {
          types.push(t)
        }
      }
    }
  }

  return types.length > 0 ? types : null
}
