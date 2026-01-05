/**
 * Shared type definitions for xano-cli
 */

// Object types supported by Xano
export type XanoObjectType =
  | 'function'
  | 'api_endpoint'
  | 'api_group'
  | 'table'
  | 'table_trigger'
  | 'middleware'
  | 'addon'
  | 'task'

// xano.json - versioned project config
export interface XanoProjectConfig {
  instance: string
  workspace: string
  workspaceId: number
  paths: {
    functions: string
    tables: string
    apis: string
    tasks: string
    [key: string]: string
  }
}

// .xano/config.json - VSCode compatible local config
export interface XanoLocalConfig {
  instanceName: string
  workspaceName: string
  workspaceId: number
  branch: string
  paths: {
    functions: string
    tables: string
    apis: string
    tasks: string
    [key: string]: string
  }
}

// Single object in .xano/objects.json (VSCode compatible)
export interface XanoObject {
  id: number
  type: XanoObjectType
  path: string
  status: 'unchanged' | 'modified' | 'new' | 'deleted'
  staged: boolean
  sha256: string
  original: string // base64 encoded original content
}

// .xano/objects.json - array of objects
export type XanoObjectsFile = XanoObject[]

// Single entry in .xano/state.json (CLI owned)
export interface XanoStateEntry {
  etag?: string
  key: string
}

// .xano/state.json - keyed by filepath
export interface XanoStateFile {
  [filepath: string]: XanoStateEntry
}

// Combined object info from objects.json + state.json
export interface XanoObjectInfo {
  id?: number
  type?: XanoObjectType
  path: string
  status?: 'unchanged' | 'modified' | 'new' | 'deleted'
  staged?: boolean
  sha256?: string
  original?: string
  etag?: string
  key?: string
}

// Profile from ~/.xano/credentials.yaml
export interface XanoProfile {
  account_origin?: string
  instance_origin: string
  access_token: string
  workspace?: string
  branch?: string
}

export interface XanoCredentials {
  profiles: {
    [name: string]: XanoProfile
  }
  default?: string
}

// API response types
export interface XanoApiFunction {
  id: number
  name: string
  guid: string
  description?: string
  xanoscript?: string
  created_at: number
  updated_at: number
}

export interface XanoApiEndpoint {
  id: number
  verb: string
  path: string
  guid: string
  description?: string
  xanoscript?: string
  created_at: number
  updated_at: number
  apigroup_id: number
}

export interface XanoApiGroup {
  id: number
  name: string
  guid: string
  description?: string
  created_at: number
  updated_at: number
}

export interface XanoApiTable {
  id: number
  name: string
  guid: string
  description?: string
  xanoscript?: string
  created_at: number
  updated_at: number
}

export interface XanoApiTask {
  id: number
  name: string
  guid: string
  description?: string
  xanoscript?: string
  created_at: number
  updated_at: number
}

export interface XanoApiBranch {
  id: number
  name: string
  is_default: boolean
  is_live: boolean
}

// Status types for CLI output
export type FileStatus = 'modified' | 'new' | 'deleted' | 'unchanged' | 'conflict' | 'orphan'

export interface StatusEntry {
  path: string
  status: FileStatus
  id?: number
  type?: XanoObjectType
  key?: string
  message?: string
}
