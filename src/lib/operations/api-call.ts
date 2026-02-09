/**
 * API Call Operations
 *
 * Shared logic for calling live API endpoints across all interfaces.
 */

import type { RequestDebugInfo } from '../api.js'
import type { OperationContext } from './context.js'

import { findMatchingEndpoint, loadEndpoints, loadGroups } from '../objects.js'

/**
 * Parameters for calling a live API endpoint
 */
export interface ApiCallParams {
  apiGroup?: string
  body?: Record<string, unknown>
  headers?: Record<string, string>
  method: string
  path: string
}

/**
 * Result of an API call operation
 */
export interface ApiCallResult {
  _debug?: RequestDebugInfo
  data?: unknown
  error?: string
  ok: boolean
  status?: number
}

/**
 * Error thrown when API call operation fails
 */
export class ApiCallError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'ApiCallError'
  }
}

/**
 * Normalize an endpoint path
 *
 * Ensures path starts with a single forward slash.
 */
export function normalizePath(path: string): string {
  let normalized = path
  // Remove multiple leading slashes and ensure single leading slash
  while (normalized.startsWith('//')) {
    normalized = normalized.slice(1)
  }

  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized
  }

  return normalized
}

/**
 * Resolve the canonical ID for an API endpoint
 *
 * Resolution strategy:
 * 1. If apiGroup is provided, look it up in groups.json
 * 2. Otherwise, use findMatchingEndpoint to resolve from path
 *
 * @throws ApiCallError if resolution fails or is ambiguous
 */
export function resolveCanonical(
  projectRoot: string,
  method: string,
  path: string,
  apiGroup?: string
): string {
  const groups = loadGroups(projectRoot)

  // If group is explicitly provided, use it
  if (apiGroup) {
    // Try as group name first
    const groupInfo = groups[apiGroup]
    if (groupInfo) {
      return groupInfo.canonical
    }

    // Try as canonical ID (check if any group has this canonical)
    for (const info of Object.values(groups)) {
      if (info.canonical === apiGroup) {
        return apiGroup
      }
    }

    throw new ApiCallError('INVALID_GROUP', `API group not found: ${apiGroup}`)
  }

  // Auto-resolve from path using endpoints.json
  const endpoints = loadEndpoints(projectRoot)

  // Check if we have endpoint data
  const hasEndpointData = Object.values(endpoints).some(arr => arr.length > 0)
  if (!hasEndpointData) {
    throw new ApiCallError(
      'NO_ENDPOINT_DATA',
      'No endpoint data found. Run "xano pull --sync" first to sync endpoint metadata.'
    )
  }

  // findMatchingEndpoint may throw on ambiguity
  const match = findMatchingEndpoint(endpoints, method, path)
  if (!match) {
    throw new ApiCallError(
      'ENDPOINT_NOT_FOUND',
      `Could not find API endpoint: ${method} ${path}. ` +
      'Verify the path exists and endpoint data is synced.'
    )
  }

  return match.canonical
}

/**
 * Call a live API endpoint
 *
 * This is the main entry point for API calls. It handles:
 * - Path normalization
 * - Canonical resolution (from group or endpoint matching)
 * - Header construction
 * - API call execution
 * - Datasource passing
 *
 * @throws ApiCallError if context is not properly initialized or resolution fails
 */
export async function callApiEndpoint(
  ctx: OperationContext,
  params: ApiCallParams
): Promise<ApiCallResult> {
  // Validate context
  if (!ctx.projectRoot) {
    throw new ApiCallError('NO_PROJECT', 'Not in a Xano project')
  }

  if (!ctx.api) {
    throw new ApiCallError('NO_API', 'API not initialized. Check profile configuration.')
  }

  // Normalize path
  const endpointPath = normalizePath(params.path)

  // Resolve canonical (may throw ApiCallError)
  const canonical = resolveCanonical(
    ctx.projectRoot,
    params.method,
    endpointPath,
    params.apiGroup
  )

  // Build headers
  const requestHeaders: Record<string, string> = { ...params.headers }

  // Make the API call
  const response = await ctx.api.callLiveApi(
    canonical,
    endpointPath,
    params.method,
    params.body,
    Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
    ctx.datasource,
  )

  return {
    _debug: response._debug,
    data: response.data,
    error: response.error,
    ok: response.ok,
    status: response.status,
  }
}

/**
 * List available API groups
 */
export function listApiGroups(ctx: OperationContext): Array<{
  baseUrl: string
  canonical: string
  name: string
}> {
  if (!ctx.projectRoot || !ctx.config) {
    throw new ApiCallError('NO_PROJECT', 'Not in a Xano project')
  }

  const groups = loadGroups(ctx.projectRoot)
  const instance = ctx.config.instanceName

  return Object.entries(groups).map(([name, info]) => ({
    baseUrl: `https://${info.canonical}.${instance}.xano.io/api:${info.canonical}`,
    canonical: info.canonical,
    name,
  }))
}
