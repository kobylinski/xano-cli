/**
 * Shared type definitions for xano-cli
 */

// Object types supported by Xano
export type XanoObjectType =
  | 'addon'
  | 'api_endpoint'
  | 'api_group'
  | 'function'
  | 'middleware'
  | 'table'
  | 'table_trigger'
  | 'task'
  | 'workflow_test'

// Paths configuration (VSCode extension compatible - camelCase keys)
export interface XanoPaths {
  addOns?: string
  agentTriggers?: string
  agents?: string
  apis: string
  functions: string
  mcpServerTriggers?: string
  mcpServers?: string
  middlewares?: string
  realtimeChannels?: string
  realtimeTriggers?: string
  tableTriggers?: string
  tables: string
  tasks: string
  tools?: string
  workflowTests: string
  [key: string]: string | undefined
}

// xano.json - versioned project config
export interface XanoProjectConfig {
  instance: string
  paths: XanoPaths
  workspace: string
  workspaceId: number
}

// Path resolver function type
export type PathResolver = (
  obj: { group?: string; id: number; name: string; path?: string; table?: string; type: XanoObjectType; verb?: string },
  paths: XanoPaths
) => string | null

// Sanitize function type
export type SanitizeFunction = (name: string) => string

// Type resolver function type - resolves user input path to object types
export type TypeResolver = (
  inputPath: string,
  paths: XanoPaths
) => XanoObjectType[] | null

// xano.js dynamic config
export interface XanoDynamicConfig extends XanoProjectConfig {
  resolvePath?: PathResolver
  resolveType?: TypeResolver
  sanitize?: SanitizeFunction
}

// .xano/config.json - VSCode compatible local config
export interface XanoLocalConfig {
  branch: string
  instanceName: string
  paths: XanoPaths
  workspaceId: number
  workspaceName: string
}

// Single object in .xano/objects.json (VSCode compatible)
// Status values match VSCode extension: new, unchanged, changed, error, notfound
export interface XanoObject {
  id: number
  original: string // base64 encoded original content
  path: string
  sha256: string
  staged: boolean // kept for VSCode extension compatibility
  status: 'changed' | 'error' | 'new' | 'notfound' | 'unchanged'
  type: XanoObjectType
}

// .xano/objects.json - array of objects
export type XanoObjectsFile = XanoObject[]

// Profile from ~/.xano/credentials.yaml
export interface XanoProfile {
  access_token: string
  account_origin?: string
  branch?: string
  instance_origin: string
  workspace?: string
}

export interface XanoCredentials {
  default?: string
  profiles: {
    [name: string]: XanoProfile
  }
}

// API response types
export interface XanoApiFunction {
  created_at: number
  description?: string
  guid: string
  id: number
  name: string
  updated_at: number
  xanoscript?: string
}

export interface XanoApiEndpoint {
  apigroup_id: number
  created_at: number | string
  description?: string
  guid: string
  id: number
  name: string // API returns 'name' as the endpoint path (e.g., "merchants")
  path?: string // Kept for compatibility
  updated_at: number | string
  verb: string
  xanoscript?: string | { status?: string; value: string; }
}

export interface XanoApiGroup {
  created_at: number
  description?: string
  guid: string
  id: number
  name: string
  updated_at: number
}

export interface XanoApiTable {
  created_at: number
  description?: string
  guid: string
  id: number
  name: string
  updated_at: number
  xanoscript?: string
}

export interface XanoApiTask {
  created_at: number
  description?: string
  guid: string
  id: number
  name: string
  updated_at: number
  xanoscript?: string
}

export interface XanoApiWorkflowTest {
  created_at: number | string
  description?: string
  guid: string
  id: number
  name: string
  tag?: string[]
  updated_at: number | string
  xanoscript?: string | { status?: string; value: string }
}

export interface XanoApiBranch {
  id: number
  is_default: boolean
  is_live: boolean
  name: string
}

export interface XanoApiTableTrigger {
  created_at: number | string
  description?: string
  guid: string
  id: number
  name: string
  table_id: number
  updated_at: number | string
  xanoscript?: string | { status?: string; value: string }
}

export interface XanoApiAddon {
  created_at: number | string
  description?: string
  guid: string
  id: number
  name: string
  updated_at: number | string
  xanoscript?: string | { status?: string; value: string }
}

// Status types for CLI output
export type FileStatus = 'conflict' | 'deleted' | 'modified' | 'new' | 'remote_only' | 'unchanged'

export interface StatusEntry {
  id?: number
  message?: string
  path: string
  status: FileStatus
  type?: XanoObjectType
}
