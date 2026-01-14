/**
 * Shared type definitions for xano-cli
 */

// Naming modes for file generation
// - default: CLI native (nested triggers, flat API group files)
// - vscode/vscode_name: VSCode extension (flat triggers, API group folders)
// - vscode_id: VSCode with ID prefix: 123_my_function.xs, 456_users_GET.xs
export type NamingMode = 'default' | 'vscode' | 'vscode_id' | 'vscode_name'

// Context passed to custom resolver functions (sanitize, resolvePath)
export interface ResolverContext {
  default: string         // Default result for current naming mode
  naming: NamingMode      // Current naming mode
  type: XanoObjectType    // Resolved object type
}

// Object types supported by Xano (VSCode extension compatible)
export type XanoObjectType =
  | 'addon'
  | 'agent'
  | 'agent_trigger'
  | 'api_endpoint'
  | 'api_group'
  | 'function'
  | 'mcp_server'
  | 'mcp_server_trigger'
  | 'middleware'
  | 'realtime_channel'
  | 'realtime_trigger'
  | 'table'
  | 'table_trigger'
  | 'task'
  | 'tool'
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
  naming?: NamingMode  // File naming mode (default: 'vscode' for auto-detect)
  paths: XanoPaths
  workspace: string
  workspaceId: number
}

// Path resolver function type
// Returns custom path or null to use default
export type PathResolver = (
  obj: { group?: string; id: number; name: string; path?: string; table?: string; type: XanoObjectType; verb?: string },
  paths: XanoPaths,
  context: ResolverContext
) => string | null

// Sanitize function type
// Returns sanitized name, can use context.default to delegate to default sanitization
export type SanitizeFunction = (name: string, context: ResolverContext) => string

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
  naming?: NamingMode  // File naming mode (default: 'vscode' for auto-detect)
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
  workspace?: number | string  // number (ID) or string (name) for backward compatibility
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
  xanoscript?: string | { status?: string; value: string }
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
  backup: boolean
  created_at: string
  label: string
  live?: boolean
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

export interface XanoApiMiddleware {
  created_at: number | string
  description?: string
  guid: string
  id: number
  name: string
  updated_at: number | string
  xanoscript?: string | { status?: string; value: string }
}

export interface XanoDataSource {
  color: string
  label: string
}

// Request history item from Xano API
export interface RequestHistoryItem {
  api_id?: number           // API group ID
  branch?: string           // Branch name
  created_at: number | string  // Timestamp (ms or ISO string)
  duration: number          // Duration in seconds
  id: number | string       // Request ID
  input?: unknown           // Request input
  input_size?: number       // Input size in bytes
  output?: unknown          // Response output
  output_size?: number      // Output size in bytes
  query_id?: number         // Endpoint ID
  request_headers?: string[] // Request headers
  response_headers?: string[] // Response headers
  status: number            // HTTP status code
  uri?: string              // Full request URI
  verb?: string             // HTTP method
  workspace_id?: number     // Workspace ID
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
