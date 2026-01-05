/**
 * XanoScript type detection and key extraction
 * Detects object type from content and extracts natural key
 */

import * as path from 'node:path'

import type { XanoObjectType } from './types.js'

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

    // Match: keyword name { or keyword name (
    const match = cleanLine.match(/^(function|table|table_trigger|query|api_group|middleware|addon|task)\s+([a-zA-Z_][a-zA-Z0-9_]*)/i)
    if (match) {
      return match[2]
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
    case 'task': {
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

  return null
}

/**
 * Generate expected file path from object data
 */
export function generateFilePath(
  type: XanoObjectType,
  name: string,
  id: number,
  paths: { apis: string; functions: string; tables: string; tasks: string },
  apiGroup?: string,
  verb?: string
): string {
  switch (type) {
    case 'addon': {
      return `addons/${id}_${name}.xs`
    }

    case 'api_endpoint': {
      const group = apiGroup || 'default'
      const v = verb?.toUpperCase() || 'GET'
      const safeName = name.replaceAll('/', '_').replaceAll(/[{}]/g, '')
      return `${paths.apis}/${group}/${id}_${v}_${safeName}.xs`
    }

    case 'api_group': {
      return `${paths.apis}/${name}/_group.xs`
    }

    case 'function': {
      return `${paths.functions}/${id}_${name}.xs`
    }

    case 'middleware': {
      return `middleware/${id}_${name}.xs`
    }

    case 'table': {
      return `${paths.tables}/${id}_${name}.xs`
    }

    case 'table_trigger': {
      return `${paths.tables}/triggers/${id}_${name}.xs`
    }

    case 'task': {
      return `${paths.tasks}/${id}_${name}.xs`
    }

    default: {
      return `${id}_${name}.xs`
    }
  }
}
