/**
 * XanoScript type detection and key extraction
 * Detects object type from content and extracts natural key
 */

import * as path from 'node:path'

import type { XanoObjectType, XanoPaths } from './types.js'

/**
 * Sanitize a single name segment for filesystem usage
 * Converts to lowercase snake_case
 */
export function sanitize(name: string): string {
  return name
    .replace(/((?<!^)[A-Z][a-z]+)/g, '_$1')  // camelCase → snake_case
    .toLowerCase()
    .replace(/[\s-]+/g, '_')                  // spaces/hyphens → underscore
    .replace(/[^a-z0-9_]/g, '_')              // remove invalid chars
    .replace(/_+/g, '_')                      // collapse underscores
    .replace(/^_|_$/g, '')                    // trim leading/trailing
}

/**
 * Sanitize a path that may contain forward slashes
 * "User/Security Events/Log Auth" → "user/security_events/log_auth"
 */
export function sanitizePath(name: string, sanitizeFn: (s: string) => string = sanitize): string {
  // Split by forward slash, sanitize each segment, rejoin
  const segments = name.split('/')
  return segments
    .map(segment => sanitizeFn(segment.trim()))
    .filter(segment => segment.length > 0)
    .join('/')
}

/**
 * Detect XanoScript object type from content
 */
export function detectType(content: string): null | XanoObjectType {
  const trimmed = content.trim()

  // Check first non-comment line
  const lines = trimmed.split('\n')
  for (const line of lines) {
    const cleanLine = line.trim()

    // Skip comments and empty lines
    if (cleanLine.startsWith('//') || cleanLine === '') {
      continue
    }

    // Match patterns
    if (cleanLine.startsWith('function ')) return 'function'
    if (cleanLine.startsWith('table ')) return 'table'
    if (cleanLine.startsWith('table_trigger ')) return 'table_trigger'
    if (cleanLine.startsWith('query ')) return 'api_endpoint'
    if (cleanLine.startsWith('api_group ')) return 'api_group'
    if (cleanLine.startsWith('middleware ')) return 'middleware'
    if (cleanLine.startsWith('addon ')) return 'addon'
    if (cleanLine.startsWith('task ')) return 'task'
    if (cleanLine.startsWith('workflow_test ')) return 'workflow_test'

    // No match on first significant line
    return null
  }

  return null
}

/**
 * Extract name from XanoScript content
 * e.g., "function calculate_totals { ... }" -> "calculate_totals"
 */
export function extractName(content: string): null | string {
  const trimmed = content.trim()
  const lines = trimmed.split('\n')

  for (const line of lines) {
    const cleanLine = line.trim()

    // Skip comments and empty lines
    if (cleanLine.startsWith('//') || cleanLine === '') {
      continue
    }

    // Match: keyword name { or keyword name ( or keyword "name"
    const match = cleanLine.match(/^(function|table|table_trigger|query|api_group|middleware|addon|task|workflow_test)\s+(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/i)
    if (match) {
      return match[2] || match[3]
    }

    break
  }

  return null
}

/**
 * Extract API endpoint details from content
 * Returns: { verb, path, group } or null
 */
export function extractApiDetails(content: string): null | { group?: string; path: string; verb: string; } {
  const trimmed = content.trim()
  const lines = trimmed.split('\n')

  for (const line of lines) {
    const cleanLine = line.trim()

    // Skip comments and empty lines
    if (cleanLine.startsWith('//') || cleanLine === '') {
      continue
    }

    // Match: query GET|POST|PUT|DELETE|PATCH /path
    // Path can contain {id} placeholders, so only stop at whitespace or opening paren
    const match = cleanLine.match(/^query\s+(GET|POST|PUT|DELETE|PATCH)\s+([^\s(]+)/i)
    if (match) {
      return {
        path: match[2],
        verb: match[1].toUpperCase(),
      }
    }

    break
  }

  return null
}

/**
 * Extract table trigger details from content
 * Returns: { table, event } or null
 */
export function extractTriggerDetails(content: string): null | { event: string; table: string; } {
  const trimmed = content.trim()
  const lines = trimmed.split('\n')

  for (const line of lines) {
    const cleanLine = line.trim()

    // Skip comments and empty lines
    if (cleanLine.startsWith('//') || cleanLine === '') {
      continue
    }

    // Match: table_trigger name on table_name event_type
    const match = cleanLine.match(/^table_trigger\s+\w+\s+on\s+(\w+)\s+(before_insert|after_insert|before_update|after_update|before_delete|after_delete)/i)
    if (match) {
      return {
        event: match[2].toLowerCase(),
        table: match[1],
      }
    }

    break
  }

  return null
}

/**
 * Generate natural key from content
 */
export function generateKey(content: string): null | string {
  const type = detectType(content)
  if (!type) return null

  switch (type) {
    case 'addon':
    case 'api_group':
    case 'function':
    case 'middleware':
    case 'table':
    case 'task':
    case 'workflow_test': {
      const name = extractName(content)
      return name ? `${type}:${name}` : null
    }

    case 'api_endpoint': {
      const details = extractApiDetails(content)
      if (!details) return null
      return `api:${details.verb}:${details.path}`
    }

    case 'table_trigger': {
      const name = extractName(content)
      const details = extractTriggerDetails(content)
      if (!name || !details) return null
      return `trigger:${details.table}:${details.event}:${name}`
    }

    default: {
      return null
    }
  }
}

/**
 * Generate key from file path (fallback when content not available)
 */
export function generateKeyFromPath(filePath: string): null | string {
  const ext = path.extname(filePath)
  if (ext !== '.xs') return null

  const basename = path.basename(filePath, ext)
  const dir = path.dirname(filePath)
  const parts = dir.split(path.sep)

  // Detect type from directory structure
  if (parts.includes('functions')) {
    return `function:${basename}`
  }

  if (parts.includes('tables')) {
    // Could be table or trigger
    if (basename.includes('_trigger_') || parts.includes('triggers')) {
      return `trigger:${basename}`
    }

    return `table:${basename}`
  }

  if (parts.includes('apis')) {
    // Extract verb from filename pattern: ID_VERB_path.xs
    const match = basename.match(/^\d+_(\w+)_/)
    if (match) {
      const verb = match[1].toUpperCase()
      return `api:${verb}:${basename}`
    }

    return `api:${basename}`
  }

  if (parts.includes('tasks')) {
    return `task:${basename}`
  }

  if (parts.includes('workflow_tests')) {
    return `workflow_test:${basename}`
  }

  return null
}

/**
 * Detect type from file path
 */
export function detectTypeFromPath(filePath: string): null | XanoObjectType {
  const dir = path.dirname(filePath)
  const parts = dir.split(path.sep)

  if (parts.includes('functions')) return 'function'
  if (parts.includes('tables')) {
    const basename = path.basename(filePath, '.xs')
    if (basename.includes('trigger')) return 'table_trigger'
    return 'table'
  }

  if (parts.includes('apis')) return 'api_endpoint'
  if (parts.includes('tasks')) return 'task'
  if (parts.includes('workflow_tests')) return 'workflow_test'

  return null
}

/**
 * Object info passed to path resolver
 */
export interface PathResolverObject {
  group?: string
  id: number
  name: string
  path?: string
  table?: string
  type: XanoObjectType
  verb?: string
}

/**
 * Generate expected file path from object data
 * Uses new naming convention without ID prefix
 */
export function generateFilePath(
  obj: PathResolverObject,
  paths: XanoPaths,
  customSanitize?: (name: string) => string,
  customResolver?: (obj: PathResolverObject, paths: XanoPaths) => string | null
): string {
  // Try custom resolver first
  if (customResolver) {
    const customPath = customResolver(obj, paths)
    if (customPath) {
      return customPath
    }
  }

  const s = customSanitize || sanitize
  // Helper for path-aware sanitization (handles forward slashes as subdirectories)
  const sp = (name: string) => sanitizePath(name, s)

  switch (obj.type) {
    case 'addon': {
      const addonDir = paths.addOns || 'addons'
      return `${addonDir}/${sp(obj.name)}.xs`
    }

    case 'api_endpoint': {
      const group = sp(obj.group || 'default')
      const v = (obj.verb || 'GET').toUpperCase()
      const apiPath = s(obj.path || obj.name)
      return `${paths.apis}/${group}/${apiPath}_${v}.xs`
    }

    case 'api_group': {
      return `${paths.apis}/${sp(obj.name)}.xs`
    }

    case 'function': {
      return `${paths.functions}/${sp(obj.name)}.xs`
    }

    case 'middleware': {
      const middlewareDir = paths.middlewares || 'middlewares'
      return `${middlewareDir}/${sp(obj.name)}.xs`
    }

    case 'table': {
      return `${paths.tables}/${sp(obj.name)}.xs`
    }

    case 'table_trigger': {
      const tableName = s(obj.table || 'unknown')
      const baseDir = paths.tableTriggers || `${paths.tables}/triggers`
      return `${baseDir}/${tableName}/${sp(obj.name)}.xs`
    }

    case 'task': {
      return `${paths.tasks}/${sp(obj.name)}.xs`
    }

    case 'workflow_test': {
      return `${paths.workflowTests}/${sp(obj.name)}.xs`
    }

    default: {
      return `${sp(obj.name)}.xs`
    }
  }
}

/**
 * Legacy function for backwards compatibility
 * @deprecated Use generateFilePath with PathResolverObject instead
 */
export function generateFilePathLegacy(
  type: XanoObjectType,
  name: string,
  id: number,
  paths: { apis: string; functions: string; tables: string; tasks: string; workflowTests: string },
  apiGroup?: string,
  verb?: string
): string {
  return generateFilePath(
    { group: apiGroup, id, name, path: name, type, verb },
    { ...paths, tableTriggers: `${paths.tables}/triggers` }
  )
}
