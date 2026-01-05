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

// xano.json - versioned project config
export interface XanoProjectConfig {
  instance: string
  paths: {
    [key: string]: string
    apis: string
    functions: string
    tables: string
    tasks: string
  }
  workspace: string
  workspaceId: number
}

// .xano/config.json - VSCode compatible local config
export interface XanoLocalConfig {
  branch: string
  instanceName: string
  paths: {
    [key: string]: string
    apis: string
    functions: string
    tables: string
    tasks: string
  }
  workspaceId: number
  workspaceName: string
}

// Single object in .xano/objects.json (VSCode compatible)
export interface XanoObject {
  id: number
  original: string // base64 encoded original content
  path: string
  sha256: string
  staged: boolean
  status: 'deleted' | 'modified' | 'new' | 'unchanged'
  type: XanoObjectType
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
  etag?: string
  id?: number
  key?: string
  original?: string
  path: string
  sha256?: string
  staged?: boolean
  status?: 'deleted' | 'modified' | 'new' | 'unchanged'
  type?: XanoObjectType
}

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

export interface XanoApiBranch {
  id: number
  is_default: boolean
  is_live: boolean
  name: string
}

// Status types for CLI output
export type FileStatus = 'conflict' | 'deleted' | 'modified' | 'new' | 'orphan' | 'unchanged'

export interface StatusEntry {
  id?: number
  key?: string
  message?: string
  path: string
  status: FileStatus
  type?: XanoObjectType
}
