/**
 * Data Operations
 *
 * Shared logic for table data operations across all interfaces.
 */

import type { OperationContext } from './context.js'

import { loadObjects } from '../objects.js'

/**
 * Error thrown when data operation fails
 */
export class DataOperationError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'DataOperationError'
  }
}

/**
 * Pagination info returned from list operations
 */
export interface PaginationInfo {
  page: number
  pageTotal: number
  perPage: number
  total: number
}

/**
 * Result of a data operation
 */
export interface DataResult<T = unknown> {
  data?: T
  error?: string
  ok: boolean
  pagination?: PaginationInfo
}

/**
 * Resolve a table identifier to a numeric ID
 *
 * Resolution strategy:
 * 1. If already a number, return it
 * 2. If string that parses to number, return parsed
 * 3. Check cache for previously resolved name
 * 4. Look up in objects.json by name match
 * 5. Fall back to API lookup
 *
 * @throws DataOperationError if table not found
 */
export async function resolveTableId(
  ctx: OperationContext,
  tableIdOrName: number | string
): Promise<number> {
  // If already a number, return it
  if (typeof tableIdOrName === 'number') {
    return tableIdOrName
  }

  // If string parses to number, return it
  const parsed = Number.parseInt(tableIdOrName, 10)
  if (!Number.isNaN(parsed) && String(parsed) === tableIdOrName) {
    return parsed
  }

  // Check cache
  const cached = ctx.tableIdCache.get(tableIdOrName.toLowerCase())
  if (cached !== undefined) {
    return cached
  }

  // Look up in objects.json
  if (ctx.projectRoot) {
    const objects = loadObjects(ctx.projectRoot)
    const tableObj = objects.find(
      obj => obj.type === 'table' && obj.path.toLowerCase().includes(tableIdOrName.toLowerCase())
    )
    if (tableObj) {
      ctx.tableIdCache.set(tableIdOrName.toLowerCase(), tableObj.id)
      return tableObj.id
    }
  }

  // Fall back to API lookup
  if (ctx.api) {
    const response = await ctx.api.listTables(1, 200)
    if (response.ok && response.data) {
      for (const table of response.data.items) {
        ctx.tableIdCache.set(table.name.toLowerCase(), table.id)
        if (table.name.toLowerCase() === tableIdOrName.toLowerCase()) {
          return table.id
        }
      }
    }
  }

  throw new DataOperationError('TABLE_NOT_FOUND', `Table not found: ${tableIdOrName}`)
}

/**
 * Validate that context has required API
 */
function requireApi(ctx: OperationContext): void {
  if (!ctx.api) {
    throw new DataOperationError('NO_API', 'API not initialized')
  }
}

/**
 * List all tables in the workspace
 */
export async function listTables(
  ctx: OperationContext,
  page = 1,
  perPage = 100
): Promise<DataResult<Array<{ id: number; name: string }>>> {
  requireApi(ctx)

  const response = await ctx.api!.listTables(page, perPage)

  if (!response.ok) {
    return { error: response.error, ok: false }
  }

  const tables = response.data?.items ?? []

  // Cache table IDs
  for (const table of tables) {
    ctx.tableIdCache.set(table.name.toLowerCase(), table.id)
  }

  return {
    data: tables.map(t => ({ id: t.id, name: t.name })),
    ok: true,
  }
}

/**
 * Options for listing records with search and sort
 */
export interface ListRecordsOptions {
  page?: number
  perPage?: number
  search?: Record<string, unknown>[]
  sort?: Record<string, 'asc' | 'desc'>[]
}

/**
 * List records from a table, optionally with search filters and sorting
 */
export async function listRecords(
  ctx: OperationContext,
  table: number | string,
  options: ListRecordsOptions = {}
): Promise<DataResult<unknown[]>> {
  requireApi(ctx)

  const tableId = await resolveTableId(ctx, table)
  const { page = 1, perPage = 100, search, sort } = options

  // Use search endpoint if filters or sort provided
  const hasSearch = search && search.length > 0
  const hasSort = sort && sort.length > 0

  const response = hasSearch || hasSort
    ? await ctx.api!.searchTableContent(tableId, {
        datasource: ctx.datasource,
        page,
        perPage,
        search,
        sort,
      })
    : await ctx.api!.listTableContent(tableId, page, perPage, ctx.datasource)

  if (!response.ok) {
    return { error: response.error, ok: false }
  }

  return {
    data: response.data?.items,
    ok: true,
    pagination: {
      page: response.data?.curPage ?? page,
      pageTotal: response.data?.pageTotal ?? 1,
      perPage,
      total: response.data?.itemsTotal ?? 0,
    },
  }
}

/**
 * Get a single record by ID
 */
export async function getRecord(
  ctx: OperationContext,
  table: number | string,
  id: number | string
): Promise<DataResult> {
  requireApi(ctx)

  const tableId = await resolveTableId(ctx, table)
  const response = await ctx.api!.getTableContent(tableId, id, ctx.datasource)

  if (!response.ok) {
    return { error: response.error, ok: false }
  }

  return { data: response.data, ok: true }
}

/**
 * Create a new record
 */
export async function createRecord(
  ctx: OperationContext,
  table: number | string,
  data: Record<string, unknown>
): Promise<DataResult> {
  requireApi(ctx)

  const tableId = await resolveTableId(ctx, table)
  const response = await ctx.api!.createTableContent(tableId, data, ctx.datasource)

  if (!response.ok) {
    return { error: response.error, ok: false }
  }

  return { data: response.data, ok: true }
}

/**
 * Update a record by ID
 */
export async function updateRecord(
  ctx: OperationContext,
  table: number | string,
  id: number | string,
  data: Record<string, unknown>
): Promise<DataResult> {
  requireApi(ctx)

  const tableId = await resolveTableId(ctx, table)
  const response = await ctx.api!.updateTableContent(tableId, id, data, ctx.datasource)

  if (!response.ok) {
    return { error: response.error, ok: false }
  }

  return { data: response.data, ok: true }
}

/**
 * Delete a record by ID
 */
export async function deleteRecord(
  ctx: OperationContext,
  table: number | string,
  id: number | string
): Promise<DataResult<void>> {
  requireApi(ctx)

  const tableId = await resolveTableId(ctx, table)
  const response = await ctx.api!.deleteTableContent(tableId, id, ctx.datasource)

  if (!response.ok) {
    return { error: response.error, ok: false }
  }

  return { ok: true }
}

/**
 * Bulk create multiple records
 */
export async function bulkCreateRecords(
  ctx: OperationContext,
  table: number | string,
  records: Array<Record<string, unknown>>
): Promise<DataResult<unknown[]>> {
  requireApi(ctx)

  const tableId = await resolveTableId(ctx, table)
  const response = await ctx.api!.bulkCreateTableContent(tableId, records, ctx.datasource)

  if (!response.ok) {
    return { error: response.error, ok: false }
  }

  return { data: response.data as unknown[], ok: true }
}
