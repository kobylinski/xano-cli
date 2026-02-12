/**
 * XanoScript type detection and key extraction
 * Detects object type from content and extracts natural key
 */

import { basename, dirname, extname, sep } from 'node:path'

import type { NamingMode, ResolverContext, XanoObjectType, XanoPaths } from './types.js'

/**
 * Sanitize a single name segment for filesystem usage
 * Converts to lowercase snake_case
 */
export function sanitize(name: string): string {
  return name
    .replaceAll(/((?<!^)[A-Z][a-z]+)/g, '_$1')  // camelCase → snake_case
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_')                  // spaces/hyphens → underscore
    .replaceAll(/[^a-z0-9_]/g, '_')              // remove invalid chars
    .replaceAll(/_+/g, '_')                      // collapse underscores
    .replaceAll(/^_|_$/g, '')                    // trim leading/trailing
}

/**
 * VSCode-compatible snake_case conversion (matches lodash.snakeCase)
 * "MyFunctionName" → "my_function_name"
 * "API Endpoint" → "api_endpoint"
 */
export function snakeCase(str: string): string {
  return str
    .replaceAll(/([a-z])([A-Z])/g, '$1_$2')     // camelCase → snake_case
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1_$2') // ABCDef → ABC_Def
    .replaceAll(/[\s\-./]+/g, '_')              // spaces, hyphens, dots, slashes → underscore
    .replaceAll(/[^a-zA-Z0-9_]/g, '')           // remove other invalid chars
    .toLowerCase()
    .replaceAll(/_+/g, '_')                      // collapse underscores
    .replaceAll(/^_|_$/g, '')                    // trim leading/trailing
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
    // AI-related types
    if (cleanLine.startsWith('agent ')) return 'agent'
    if (cleanLine.startsWith('agent_trigger ')) return 'agent_trigger'
    if (cleanLine.startsWith('tool ')) return 'tool'
    if (cleanLine.startsWith('mcp_server ')) return 'mcp_server'
    if (cleanLine.startsWith('mcp_server_trigger ')) return 'mcp_server_trigger'
    // Realtime types
    if (cleanLine.startsWith('realtime_channel ')) return 'realtime_channel'
    if (cleanLine.startsWith('realtime_trigger ')) return 'realtime_trigger'

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
    const match = cleanLine.match(/^(function|table|table_trigger|query|api_group|middleware|addon|task|workflow_test|agent|agent_trigger|tool|mcp_server|mcp_server_trigger|realtime_channel|realtime_trigger)\s+(?:"([^"]+)"|([a-zA-Z_][a-zA-Z0-9_]*))/i)
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
  const ext = extname(filePath)
  if (ext !== '.xs') return null

  const fileBasename = basename(filePath, ext)
  const dir = dirname(filePath)
  const parts = dir.split(sep)

  // Detect type from directory structure
  if (parts.includes('functions')) {
    return `function:${fileBasename}`
  }

  if (parts.includes('tables')) {
    // Could be table or trigger
    if (fileBasename.includes('_trigger_') || parts.includes('triggers')) {
      return `trigger:${fileBasename}`
    }

    return `table:${fileBasename}`
  }

  if (parts.includes('apis')) {
    // Extract verb from filename pattern: ID_VERB_path.xs
    const match = fileBasename.match(/^\d+_(\w+)_/)
    if (match) {
      const verb = match[1].toUpperCase()
      return `api:${verb}:${fileBasename}`
    }

    return `api:${fileBasename}`
  }

  if (parts.includes('tasks')) {
    return `task:${fileBasename}`
  }

  if (parts.includes('workflow_tests')) {
    return `workflow_test:${fileBasename}`
  }

  return null
}

/**
 * Detect type from file path
 */
export function detectTypeFromPath(filePath: string): null | XanoObjectType {
  const dir = dirname(filePath)
  const parts = dir.split(sep)

  if (parts.includes('functions')) return 'function'
  if (parts.includes('tables')) {
    const fileBasename = basename(filePath, '.xs')
    if (fileBasename.includes('trigger')) return 'table_trigger'
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
 * Options for generateFilePath
 */
export interface GenerateFilePathOptions {
  customResolver?: (obj: PathResolverObject, paths: XanoPaths, context: ResolverContext) => null | string
  customSanitize?: (name: string, context: ResolverContext) => string
  naming?: NamingMode
}

/**
 * Generate VSCode-style file path with optional ID prefix
 * Matches VSCode extension behavior exactly
 */
function generateVSCodePath(
  obj: PathResolverObject,
  paths: XanoPaths,
  includeId: boolean
): string {
  const s = snakeCase

  // Helper for path with subfolders (e.g., "User/Auth/Login" → "user/auth/login")
  const pathWithFolders = (name: string): { filename: string; folders: string } => {
    const parts = name.split('/')
    if (parts.length > 1) {
      const folders = parts.slice(0, -1).map(p => s(p)).join('/')
      const filename = s(parts.at(-1)!)
      return { filename, folders }
    }

    return { filename: s(name), folders: '' }
  }

  // Build filename with or without ID prefix
  const withId = (name: string): string => includeId ? `${obj.id}_${name}` : name

  switch (obj.type) {
    case 'addon': {
      const addonDir = paths.addOns || 'addons'
      return `${addonDir}/${withId(s(obj.name))}.xs`
    }

    case 'agent': {
      const agentDir = paths.agents || 'agents'
      return `${agentDir}/${withId(s(obj.name))}.xs`
    }

    case 'agent_trigger': {
      const triggerDir = paths.agentTriggers || 'agents/triggers'
      return `${triggerDir}/${withId(s(obj.name))}.xs`
    }

    case 'api_endpoint': {
      // VSCode: apis/groupName/path_VERB.xs or apis/groupName/id_path_VERB.xs
      const groupFolder = s(obj.group || 'default')
      const v = (obj.verb || 'GET').toUpperCase()
      const endpointPath = s(obj.path || obj.name)
      const filename = includeId
        ? `${obj.id}_${endpointPath}_${v}.xs`
        : `${endpointPath}_${v}.xs`
      return `${paths.apis}/${groupFolder}/${filename}`
    }

    case 'api_group': {
      // VSCode: apis/groupName/api_group.xs (special case - always api_group.xs in a folder)
      return `${paths.apis}/${s(obj.name)}/api_group.xs`
    }

    case 'function': {
      // VSCode preserves folder structure: functions/folder/subfolder/name.xs
      const { filename, folders } = pathWithFolders(obj.name)
      const fullFilename = withId(filename) + '.xs'
      return folders
        ? `${paths.functions}/${folders}/${fullFilename}`
        : `${paths.functions}/${fullFilename}`
    }

    case 'mcp_server': {
      const mcpDir = paths.mcpServers || 'mcp_servers'
      return `${mcpDir}/${withId(s(obj.name))}.xs`
    }

    case 'mcp_server_trigger': {
      const triggerDir = paths.mcpServerTriggers || 'mcp_servers/triggers'
      return `${triggerDir}/${withId(s(obj.name))}.xs`
    }

    case 'middleware': {
      const middlewareDir = paths.middlewares || 'middlewares'
      return `${middlewareDir}/${withId(s(obj.name))}.xs`
    }

    case 'realtime_channel': {
      const channelDir = paths.realtimeChannels || 'realtime'
      return `${channelDir}/${withId(s(obj.name))}.xs`
    }

    case 'realtime_trigger': {
      const triggerDir = paths.realtimeTriggers || 'realtime/triggers'
      return `${triggerDir}/${withId(s(obj.name))}.xs`
    }

    case 'table': {
      return `${paths.tables}/${withId(s(obj.name))}.xs`
    }

    case 'table_trigger': {
      // VSCode: flat structure - tables/triggers/{triggerName}.xs
      // Trigger name typically includes table name (e.g., "accounts_after_edit")
      const baseDir = paths.tableTriggers || `${paths.tables}/triggers`
      return `${baseDir}/${withId(s(obj.name))}.xs`
    }

    case 'task': {
      return `${paths.tasks}/${withId(s(obj.name))}.xs`
    }

    case 'tool': {
      const toolDir = paths.tools || 'tools'
      return `${toolDir}/${withId(s(obj.name))}.xs`
    }

    case 'workflow_test': {
      return `${paths.workflowTests}/${withId(s(obj.name))}.xs`
    }

    default: {
      return `${withId(s(obj.name))}.xs`
    }
  }
}

/**
 * Generate default-mode file path (CLI native behavior)
 * - Nested triggers: {tableTriggers}/{tableName}/{triggerName}.xs
 * - Flat API groups: {apis}/{groupName}.xs
 */
function generateDefaultPath(
  obj: PathResolverObject,
  paths: XanoPaths,
  s: (name: string) => string
): string {
  const sp = (name: string) => sanitizePath(name, s)

  switch (obj.type) {
    case 'addon': {
      const addonDir = paths.addOns || 'addons'
      return `${addonDir}/${sp(obj.name)}.xs`
    }

    case 'agent': {
      const agentDir = paths.agents || 'agents'
      return `${agentDir}/${sp(obj.name)}.xs`
    }

    case 'agent_trigger': {
      const triggerDir = paths.agentTriggers || 'agents/triggers'
      return `${triggerDir}/${sp(obj.name)}.xs`
    }

    case 'api_endpoint': {
      const group = sp(obj.group || 'default')
      const v = (obj.verb || 'GET').toUpperCase()
      const apiPath = s(obj.path || obj.name)
      return `${paths.apis}/${group}/${apiPath}_${v}.xs`
    }

    case 'api_group': {
      // Default mode: flat file (apis/groupName.xs)
      return `${paths.apis}/${sp(obj.name)}.xs`
    }

    case 'function': {
      return `${paths.functions}/${sp(obj.name)}.xs`
    }

    case 'mcp_server': {
      const mcpDir = paths.mcpServers || 'mcp_servers'
      return `${mcpDir}/${sp(obj.name)}.xs`
    }

    case 'mcp_server_trigger': {
      const triggerDir = paths.mcpServerTriggers || 'mcp_servers/triggers'
      return `${triggerDir}/${sp(obj.name)}.xs`
    }

    case 'middleware': {
      const middlewareDir = paths.middlewares || 'middlewares'
      return `${middlewareDir}/${sp(obj.name)}.xs`
    }

    case 'realtime_channel': {
      const channelDir = paths.realtimeChannels || 'realtime'
      return `${channelDir}/${sp(obj.name)}.xs`
    }

    case 'realtime_trigger': {
      const triggerDir = paths.realtimeTriggers || 'realtime/triggers'
      return `${triggerDir}/${sp(obj.name)}.xs`
    }

    case 'table': {
      return `${paths.tables}/${sp(obj.name)}.xs`
    }

    case 'table_trigger': {
      const tableName = s(obj.table || 'unknown')
      // Default mode: nested structure (tableTriggers/{tableName}/{triggerName}.xs)
      const baseDir = paths.tableTriggers || paths.tables
      return `${baseDir}/${tableName}/${sp(obj.name)}.xs`
    }

    case 'task': {
      return `${paths.tasks}/${sp(obj.name)}.xs`
    }

    case 'tool': {
      const toolDir = paths.tools || 'tools'
      return `${toolDir}/${sp(obj.name)}.xs`
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
 * Get the default sanitize function for a naming mode
 */
function getDefaultSanitizer(naming: NamingMode): (name: string) => string {
  switch (naming) {
    case 'vscode':
    case 'vscode_id':
    case 'vscode_name': {
      return snakeCase
    }

    default: {
      return sanitize
    }
  }
}

/**
 * Create a context-aware sanitize wrapper
 */
function createSanitizeWrapper(
  naming: NamingMode,
  type: XanoObjectType,
  customSanitize?: (name: string, context: ResolverContext) => string
): (name: string) => string {
  const defaultSanitizer = getDefaultSanitizer(naming)

  if (!customSanitize) {
    return defaultSanitizer
  }

  return (name: string) => {
    const defaultResult = defaultSanitizer(name)
    const context: ResolverContext = {
      default: defaultResult,
      naming,
      type,
    }
    return customSanitize(name, context)
  }
}

/**
 * Generate expected file path from object data
 * Supports multiple naming modes and custom overrides with context
 *
 * @param obj - Object metadata (id, name, type, etc.)
 * @param paths - Path configuration from xano.json
 * @param options - Naming mode and custom overrides
 */
export function generateFilePath(
  obj: PathResolverObject,
  paths: XanoPaths,
  options: GenerateFilePathOptions = {}
): string {
  const { customResolver, customSanitize, naming = 'default' } = options

  // Create sanitize function (with context if custom provided)
  const s = createSanitizeWrapper(naming, obj.type, customSanitize)

  // Compute default path based on naming mode
  let defaultPath: string
  switch (naming) {
    case 'vscode':
    case 'vscode_name': {
      defaultPath = generateVSCodePath(obj, paths, false)
      break
    }

    case 'vscode_id': {
      defaultPath = generateVSCodePath(obj, paths, true)
      break
    }

    default: {
      defaultPath = generateDefaultPath(obj, paths, s)
      break
    }
  }

  // Try custom resolver with context
  if (customResolver) {
    const context: ResolverContext = {
      default: defaultPath,
      naming,
      type: obj.type,
    }
    const customPath = customResolver(obj, paths, context)
    if (customPath) {
      return customPath
    }
  }

  // For VSCode modes with custom sanitize, recompute with custom sanitization
  if (customSanitize && (naming === 'vscode' || naming === 'vscode_name' || naming === 'vscode_id')) {
    return generateVSCodePathWithSanitizer(obj, paths, naming === 'vscode_id', s)
  }

  return defaultPath
}

/**
 * Generate VSCode-style path with custom sanitizer
 */
function generateVSCodePathWithSanitizer(
  obj: PathResolverObject,
  paths: XanoPaths,
  includeId: boolean,
  s: (name: string) => string
): string {
  // Helper for path with subfolders
  const pathWithFolders = (name: string): { filename: string; folders: string } => {
    const parts = name.split('/')
    if (parts.length > 1) {
      const folders = parts.slice(0, -1).map(p => s(p)).join('/')
      const filename = s(parts.at(-1)!)
      return { filename, folders }
    }

    return { filename: s(name), folders: '' }
  }

  const withId = (name: string): string => includeId ? `${obj.id}_${name}` : name

  switch (obj.type) {
    case 'addon': {
      const addonDir = paths.addOns || 'addons'
      return `${addonDir}/${withId(s(obj.name))}.xs`
    }

    case 'agent': {
      const agentDir = paths.agents || 'agents'
      return `${agentDir}/${withId(s(obj.name))}.xs`
    }

    case 'agent_trigger': {
      const triggerDir = paths.agentTriggers || 'agents/triggers'
      return `${triggerDir}/${withId(s(obj.name))}.xs`
    }

    case 'api_endpoint': {
      const groupFolder = s(obj.group || 'default')
      const v = (obj.verb || 'GET').toUpperCase()
      const endpointPath = s(obj.path || obj.name)
      const filename = includeId
        ? `${obj.id}_${endpointPath}_${v}.xs`
        : `${endpointPath}_${v}.xs`
      return `${paths.apis}/${groupFolder}/${filename}`
    }

    case 'api_group': {
      return `${paths.apis}/${s(obj.name)}/api_group.xs`
    }

    case 'function': {
      const { filename, folders } = pathWithFolders(obj.name)
      const fullFilename = withId(filename) + '.xs'
      return folders
        ? `${paths.functions}/${folders}/${fullFilename}`
        : `${paths.functions}/${fullFilename}`
    }

    case 'mcp_server': {
      const mcpDir = paths.mcpServers || 'mcp_servers'
      return `${mcpDir}/${withId(s(obj.name))}.xs`
    }

    case 'mcp_server_trigger': {
      const triggerDir = paths.mcpServerTriggers || 'mcp_servers/triggers'
      return `${triggerDir}/${withId(s(obj.name))}.xs`
    }

    case 'middleware': {
      const middlewareDir = paths.middlewares || 'middlewares'
      return `${middlewareDir}/${withId(s(obj.name))}.xs`
    }

    case 'realtime_channel': {
      const channelDir = paths.realtimeChannels || 'realtime'
      return `${channelDir}/${withId(s(obj.name))}.xs`
    }

    case 'realtime_trigger': {
      const triggerDir = paths.realtimeTriggers || 'realtime/triggers'
      return `${triggerDir}/${withId(s(obj.name))}.xs`
    }

    case 'table': {
      return `${paths.tables}/${withId(s(obj.name))}.xs`
    }

    case 'table_trigger': {
      const baseDir = paths.tableTriggers || `${paths.tables}/triggers`
      return `${baseDir}/${withId(s(obj.name))}.xs`
    }

    case 'task': {
      return `${paths.tasks}/${withId(s(obj.name))}.xs`
    }

    case 'tool': {
      const toolDir = paths.tools || 'tools'
      return `${toolDir}/${withId(s(obj.name))}.xs`
    }

    case 'workflow_test': {
      return `${paths.workflowTests}/${withId(s(obj.name))}.xs`
    }

    default: {
      return `${withId(s(obj.name))}.xs`
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

/**
 * Detect naming mode from existing files in project
 * Checks if .xs files have ID prefix (e.g., "123_filename.xs")
 *
 * @param xsFiles - Array of .xs file paths or filenames
 * @returns Detected naming mode ('vscode_id' or 'vscode_name')
 */
export function detectNamingMode(xsFiles: string[]): NamingMode {
  // Pattern: ID prefix at start of filename (e.g., "123_my_function.xs")
  const idPrefixPattern = /^\d+_/

  for (const filePath of xsFiles) {
    const filename = basename(filePath)

    // Skip special files that never have ID prefix
    if (filename === 'api_group.xs') {
      continue
    }

    // If we find any file with ID prefix, assume vscode_id mode
    if (idPrefixPattern.test(filename)) {
      return 'vscode_id'
    }
  }

  return 'vscode_name'
}

/**
 * Extract ID from filename if present
 * "123_my_function.xs" → 123
 * "my_function.xs" → null
 */
export function extractIdFromFilename(filename: string): null | number {
  const fileBasename = basename(filename, '.xs')
  const match = fileBasename.match(/^(\d+)_/)
  return match ? Number.parseInt(match[1], 10) : null
}

/**
 * XanoScript block keywords that define top-level objects
 */
const BLOCK_KEYWORDS = [
  'function',
  'table',
  'table_trigger',
  'query',
  'api_group',
  'middleware',
  'addon',
  'task',
  'workflow_test',
  // AI-related types
  'agent',
  'agent_trigger',
  'tool',
  'mcp_server',
  'mcp_server_trigger',
  // Realtime types
  'realtime_channel',
  'realtime_trigger',
]

/**
 * Count the number of top-level XanoScript blocks in content
 * Used to detect when a file contains multiple blocks (which is invalid)
 *
 * Returns an array of { keyword, name, line } for each block found
 */
export function countBlocks(content: string): Array<{ keyword: string; line: number; name: string }> {
  const blocks: Array<{ keyword: string; line: number; name: string }> = []
  const lines = content.split('\n')

  // Track brace depth to know when we're at top level
  let braceDepth = 0
  let inString = false
  let stringChar = ''

  for (const [lineIndex, line] of lines.entries()) {
    const lineNumber = lineIndex + 1

    // Process character by character to track string state and brace depth
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      const prevChar = i > 0 ? line[i - 1] : ''

      // Skip escaped characters in strings
      if (prevChar === '\\') continue

      // Toggle string state
      if ((char === '"' || char === "'") && !inString) {
        inString = true
        stringChar = char
      } else if (char === stringChar && inString) {
        inString = false
        stringChar = ''
      }

      // Track braces only outside strings
      if (!inString) {
        if (char === '{') braceDepth++
        if (char === '}') braceDepth--
      }
    }

    // Only check for keywords at brace depth 0 (before any block opens)
    // We need to check the line content before processing braces for this line
    if (braceDepth <= 1) {
      const trimmedLine = line.trim()

      // Skip comments and empty lines
      if (trimmedLine.startsWith('//') || trimmedLine === '') continue

      // Check for block keywords at line start
      for (const keyword of BLOCK_KEYWORDS) {
        if (trimmedLine.startsWith(keyword + ' ')) {
          // Must match a valid block declaration pattern:
          // - keyword followed by quoted name: function "My Name" { or workflow_test "Test Case" {
          // - keyword followed by identifier: function my_func { or table users {
          // - keyword followed by path/verb: query /path verb=GET { or query POST /path {
          // Property assignments like `api_group = "value"` should NOT match
          const match = trimmedLine.match(
            new RegExp(`^${keyword}\\s+(?:"([^"]+)"|([a-zA-Z_/][a-zA-Z0-9_/]*))`, 'i')
          )

          // Skip if no valid block declaration pattern found (e.g., api_group = "..." is a property)
          if (!match) break

          const name = match[1] || match[2] || '(unnamed)'

          // Only count if we're actually at top level (braceDepth was 0 before this line opened a brace)
          // Check if this line opens a brace
          const opensBlock = trimmedLine.includes('{')
          const depthBeforeLine = braceDepth - (opensBlock ? 1 : 0)

          if (depthBeforeLine === 0 || blocks.length === 0) {
            blocks.push({ keyword, line: lineNumber, name })
          }

          break
        }
      }
    }
  }

  return blocks
}

/**
 * Validate that a file contains only a single top-level XanoScript block
 * Returns null if valid, or an error message if invalid
 */
export function validateSingleBlock(content: string): null | string {
  const blocks = countBlocks(content)

  if (blocks.length === 0) {
    return 'No valid XanoScript block found. File must start with a keyword like function, table, query, task, agent, tool, mcp_server, etc.'
  }

  if (blocks.length > 1) {
    const blockList = blocks
      .map((b) => `  Line ${b.line}: ${b.keyword} "${b.name}"`)
      .join('\n')

    return `Multiple XanoScript blocks found in single file (only one allowed):\n${blockList}\n\nSplit into separate files - one ${blocks[0].keyword} per file.`
  }

  return null
}
