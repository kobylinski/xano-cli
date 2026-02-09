/**
 * Operations Module
 *
 * High-level operations shared across all interfaces (CLI, RPC, MCP).
 * Each interface is a thin adapter that:
 * 1. Parses input (flags/JSON-RPC params/MCP schema)
 * 2. Calls shared operations
 * 3. Formats output (console/JSON-RPC response/MCP response)
 */

// Re-export debug info type from api
export type { RequestDebugInfo } from '../api.js'

// API call operations
export {
  ApiCallError,
  callApiEndpoint,
  listApiGroups,
  normalizePath,
  resolveCanonical,
} from './api-call.js'
export type {
  ApiCallParams,
  ApiCallResult,
} from './api-call.js'

// Context management
export {
  createContext,
  getContextConfig,
  reinitializeApi,
  updateContext,
} from './context.js'
export type {
  CreateContextOptions,
  OperationContext,
} from './context.js'

// Data operations
export {
  bulkCreateRecords,
  createRecord,
  DataOperationError,
  deleteRecord,
  getRecord,
  listRecords,
  listTables,
  resolveTableId,
  updateRecord,
} from './data.js'
export type {
  DataResult,
  ListRecordsOptions,
  PaginationInfo,
} from './data.js'

// Sync operations
export {
  getFileStatus,
  pullFiles,
  pushFiles,
  syncMetadata,
  SyncOperationError,
} from './sync.js'
export type {
  FileStatus,
  PullResult,
  PushResult,
  SyncMetadataResult,
} from './sync.js'
