/**
 * JSON-RPC 2.0 Server for Xano CLI
 *
 * Provides a simple RPC interface over stdio for API calls and configuration.
 * Protocol: newline-delimited JSON-RPC 2.0
 *
 * This is a thin adapter over the shared operations layer.
 */

import * as readline from 'node:readline'

import {
  ApiCallError,
  bulkCreateRecords,
  callApiEndpoint,
  createContext,
  createRecord,
  DataOperationError,
  deleteRecord,
  getContextConfig,
  getFileStatus,
  getRecord,
  listApiGroups,
  listRecords,
  listTables,
  type OperationContext,
  pullFiles,
  pushFiles,
  syncMetadata,
  SyncOperationError,
  updateContext,
  updateRecord,
} from '../lib/operations/index.js'

const VERSION = '1.0'

// ── Types ──────────────────────────────────────────────────────────

interface JsonRpcRequest {
  id?: null | number | string
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  error?: { code: number; data?: unknown; message: string }
  id: null | number | string
  jsonrpc: '2.0'
  result?: unknown
}

// ── JSON-RPC Error Codes ───────────────────────────────────────────

const RPC_ERRORS = {
  INTERNAL_ERROR: -32_603,
  INVALID_PARAMS: -32_602,
  INVALID_REQUEST: -32_600,
  METHOD_NOT_FOUND: -32_601,
  PARSE_ERROR: -32_700,
}

class RpcError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.code = code
    this.name = 'RpcError'
  }
}

// ── Helper: Convert Operation Errors to RPC Errors ─────────────────

function toRpcError(error: unknown): RpcError {
  if (error instanceof RpcError) {
    return error
  }

  if (error instanceof ApiCallError || error instanceof DataOperationError || error instanceof SyncOperationError) {
    return new RpcError(RPC_ERRORS.INVALID_PARAMS, error.message)
  }

  return new RpcError(
    RPC_ERRORS.INTERNAL_ERROR,
    error instanceof Error ? error.message : 'Internal error'
  )
}

// ── Method Handlers ────────────────────────────────────────────────

type MethodHandler = (params: Record<string, unknown>, ctx: OperationContext) => Promise<unknown>

const methods: Record<string, MethodHandler> = {
  // ── API Methods ──────────────────────────────────────────────────

  async 'api.call'(params, ctx) {
    const { apiGroup, body, headers, method, path } = params as {
      apiGroup?: string
      body?: Record<string, unknown>
      headers?: Record<string, string>
      method: string
      path: string
    }

    if (!method || !path) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'method and path are required')
    }

    const result = await callApiEndpoint(ctx, {
      apiGroup,
      body,
      headers,
      method,
      path,
    })

    return {
      data: result.data,
      error: result.error,
      ok: result.ok,
      status: result.status,
    }
  },

  async 'api.groups'(_params, ctx) {
    return listApiGroups(ctx)
  },

  // ── Config Methods ───────────────────────────────────────────────

  async 'config'(_params, ctx) {
    return getContextConfig(ctx)
  },

  async 'config.set'(params, ctx) {
    const { datasource, profile } = params as {
      datasource?: string
      profile?: string
    }

    updateContext(ctx, {
      datasource,
      profileName: profile,
    })

    return {
      datasource: ctx.datasource,
      profile: ctx.profileName,
    }
  },

  // ── Data Methods ─────────────────────────────────────────────────

  async 'data.bulk'(params, ctx) {
    const { records, table } = params as {
      records: Array<Record<string, unknown>>
      table: number | string
    }

    if (!table) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'table is required')
    }

    if (!Array.isArray(records) || records.length === 0) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'records array is required')
    }

    const result = await bulkCreateRecords(ctx, table, records)

    return {
      data: result.data,
      error: result.error,
      ok: result.ok,
    }
  },

  async 'data.create'(params, ctx) {
    const { data, table } = params as {
      data: Record<string, unknown>
      table: number | string
    }

    if (!table) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'table is required')
    }

    if (!data || typeof data !== 'object') {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'data object is required')
    }

    const result = await createRecord(ctx, table, data)

    return {
      data: result.data,
      error: result.error,
      ok: result.ok,
    }
  },

  async 'data.delete'(params, ctx) {
    const { id, table } = params as {
      id: number | string
      table: number | string
    }

    if (!table) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'table is required')
    }

    if (id === undefined || id === null) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'id is required')
    }

    const result = await deleteRecord(ctx, table, id)

    return {
      error: result.error,
      ok: result.ok,
    }
  },

  async 'data.get'(params, ctx) {
    const { id, table } = params as {
      id: number | string
      table: number | string
    }

    if (!table) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'table is required')
    }

    if (id === undefined || id === null) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'id is required')
    }

    const result = await getRecord(ctx, table, id)

    return {
      data: result.data,
      error: result.error,
      ok: result.ok,
    }
  },

  async 'data.list'(params, ctx) {
    const { page = 1, perPage = 100, search, sort, table } = params as {
      page?: number
      perPage?: number
      search?: Record<string, unknown>[]
      sort?: Record<string, 'asc' | 'desc'>[]
      table: number | string
    }

    if (!table) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'table is required')
    }

    const result = await listRecords(ctx, table, { page, perPage, search, sort })

    if (!result.ok) {
      return {
        error: result.error,
        ok: false,
      }
    }

    return {
      data: result.data,
      ok: true,
      pagination: result.pagination,
    }
  },

  async 'data.update'(params, ctx) {
    const { data, id, table } = params as {
      data: Record<string, unknown>
      id: number | string
      table: number | string
    }

    if (!table) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'table is required')
    }

    if (id === undefined || id === null) {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'id is required')
    }

    if (!data || typeof data !== 'object') {
      throw new RpcError(RPC_ERRORS.INVALID_PARAMS, 'data object is required')
    }

    const result = await updateRecord(ctx, table, id, data)

    return {
      data: result.data,
      error: result.error,
      ok: result.ok,
    }
  },

  // ── Lifecycle Methods ────────────────────────────────────────────

  async 'pull'(params, ctx) {
    const { files, force = false } = params as {
      files?: string[]
      force?: boolean
    }

    const result = await pullFiles(ctx, files, force)

    return {
      error: result.error,
      errors: result.errors,
      ok: result.ok,
      pulled: result.pulled,
      skipped: result.skipped,
    }
  },

  // ── Tables Method ────────────────────────────────────────────────

  async 'push'(params, ctx) {
    const { files } = params as {
      files?: string[]
    }

    const result = await pushFiles(ctx, files)

    return {
      errors: result.errors,
      failed: result.failed,
      ok: result.ok,
      pushed: result.pushed,
    }
  },

  // ── Sync Methods ────────────────────────────────────────────────

  async 'shutdown'() {
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    setImmediate(() => process.exit(0))
    return { ok: true }
  },

  async 'status'(_params, ctx) {
    const status = getFileStatus(ctx)

    return {
      modified: status.modified,
      modifiedCount: status.modified.length,
      new: status.new,
      newCount: status.new.length,
      ok: true,
      total: status.modified.length + status.new.length + status.unchanged.length,
      unchangedCount: status.unchanged.length,
    }
  },

  async 'sync'(_params, ctx) {
    const result = await syncMetadata(ctx)

    return {
      error: result.error,
      newCount: result.newCount,
      ok: result.ok,
      removedCount: result.removedCount,
      totalCount: result.totalCount,
      updatedCount: result.updatedCount,
    }
  },

  async 'tables'(params, ctx) {
    const { page = 1, perPage = 100 } = params as {
      page?: number
      perPage?: number
    }

    const result = await listTables(ctx, page, perPage)

    if (!result.ok) {
      return {
        error: result.error,
        ok: false,
      }
    }

    return {
      ok: true,
      tables: result.data,
    }
  },
}

// ── Request Processing ─────────────────────────────────────────────

function parseRequest(line: string): JsonRpcRequest {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    throw new RpcError(RPC_ERRORS.PARSE_ERROR, 'Parse error')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new RpcError(RPC_ERRORS.INVALID_REQUEST, 'Invalid Request')
  }

  const req = parsed as Record<string, unknown>

  if (req.jsonrpc !== '2.0') {
    throw new RpcError(RPC_ERRORS.INVALID_REQUEST, 'Invalid Request: jsonrpc must be "2.0"')
  }

  if (typeof req.method !== 'string') {
    throw new RpcError(RPC_ERRORS.INVALID_REQUEST, 'Invalid Request: method must be a string')
  }

  const id = req.id === undefined ? null : req.id as null | number | string

  return {
    id,
    jsonrpc: '2.0',
    method: req.method,
    params: req.params as Record<string, unknown> | undefined,
  }
}

async function handleRequest(request: JsonRpcRequest, ctx: OperationContext): Promise<JsonRpcResponse> {
  const handler = methods[request.method]
  const id = request.id ?? null

  if (!handler) {
    return {
      error: { code: RPC_ERRORS.METHOD_NOT_FOUND, message: `Method not found: ${request.method}` },
      id,
      jsonrpc: '2.0',
    }
  }

  try {
    const result = await handler(request.params ?? {}, ctx)
    return {
      id,
      jsonrpc: '2.0',
      result,
    }
  } catch (error) {
    const rpcError = toRpcError(error)
    return {
      error: { code: rpcError.code, message: rpcError.message },
      id,
      jsonrpc: '2.0',
    }
  }
}

// ── Server Entry Point ─────────────────────────────────────────────

export async function runRpcServer(): Promise<void> {
  // Create shared context
  const ctx = createContext()

  // Send ready signal
  console.log(JSON.stringify({ ready: true, version: VERSION }))

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  })

  rl.on('line', async (line) => {
    if (!line.trim()) return

    let response: JsonRpcResponse

    try {
      const request = parseRequest(line)
      response = await handleRequest(request, ctx)
    } catch (error) {
      const rpcError = toRpcError(error)
      response = {
        error: { code: rpcError.code, message: rpcError.message },
        id: null,
        jsonrpc: '2.0',
      }
    }

    console.log(JSON.stringify(response))
  })

  rl.on('close', () => {
    // eslint-disable-next-line n/no-process-exit, unicorn/no-process-exit
    process.exit(0)
  })

  console.error('Xano RPC Server running on stdio')
}
