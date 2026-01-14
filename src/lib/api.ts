/**
 * Xano Metadata API client
 * Handles all API calls to Xano
 */

import * as yaml from 'js-yaml'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type {
  RequestHistoryItem,
  XanoApiAddon,
  XanoApiBranch,
  XanoApiEndpoint,
  XanoApiFunction,
  XanoApiGroup,
  XanoApiMiddleware,
  XanoApiTable,
  XanoApiTableTrigger,
  XanoApiTask,
  XanoApiWorkflowTest,
  XanoCredentials,
  XanoDataSource,
  XanoObjectType,
  XanoProfile,
} from './types.js'

const CREDENTIALS_PATH = join(homedir(), '.xano', 'credentials.yaml')

/**
 * Load credentials from ~/.xano/credentials.yaml
 */
export function loadCredentials(): null | XanoCredentials {
  if (!existsSync(CREDENTIALS_PATH)) {
    return null
  }

  try {
    const content = readFileSync(CREDENTIALS_PATH, 'utf8')
    return yaml.load(content) as XanoCredentials
  } catch {
    return null
  }
}

/**
 * Get profile by name or default
 */
export function getProfile(profileName?: string): null | XanoProfile {
  const credentials = loadCredentials()
  if (!credentials) return null

  const name = profileName || credentials.default || 'default'
  return credentials.profiles[name] || null
}

/**
 * Get default profile name
 */
export function getDefaultProfileName(): null | string {
  const credentials = loadCredentials()
  return credentials?.default || null
}

/**
 * List all profile names
 */
export function listProfileNames(): string[] {
  const credentials = loadCredentials()
  if (!credentials) return []
  return Object.keys(credentials.profiles)
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  data?: T
  error?: string
  etag?: string
  ok: boolean
  status: number
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
  profile: XanoProfile,
  method: string,
  endpoint: string,
  body?: object | string,
  contentType: string = 'application/json',
  extraHeaders?: Record<string, string>
): Promise<ApiResponse<T>> {
  const url = `${profile.instance_origin}${endpoint}`

  const headers: Record<string, string> = {
    accept: 'application/json',
    Authorization: `Bearer ${profile.access_token}`,
    ...extraHeaders,
  }

  let requestBody: string | undefined
  if (body) {
    headers['Content-Type'] = contentType
    requestBody = typeof body === 'string' ? body : JSON.stringify(body)
  }

  try {
    const response = await fetch(url, {
      body: requestBody,
      headers,
      method,
    })

    const etag = response.headers.get('etag') || undefined

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData.message || errorData.error || errorMessage
      } catch {
        // Ignore JSON parse error
      }

      return {
        error: errorMessage,
        etag,
        ok: false,
        status: response.status,
      }
    }

    const data = await response.json() as T
    return {
      data,
      etag,
      ok: true,
      status: response.status,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      ok: false,
      status: 0,
    }
  }
}

/**
 * Xano API client class
 */
export class XanoApi {
  constructor(
    private profile: XanoProfile,
    private workspaceId: number,
    private branch: string
  ) {}

  private get branchParam(): string {
    return `branch=${encodeURIComponent(this.branch)}`
  }

  // ========== Branches ==========

  /**
   * Browse request history for the workspace
   * @param options Filter options
   */
  async browseRequestHistory(options: {
    apiId?: number          // API Group ID
    branchId?: string       // Branch ID
    includeOutput?: boolean // Include response output
    page?: number
    perPage?: number
    queryId?: number        // Specific endpoint ID
  } = {}): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    const params = new URLSearchParams()
    params.set('branch', this.branch)
    if (options.page) params.set('page', options.page.toString())
    if (options.perPage) params.set('per_page', options.perPage.toString())
    if (options.apiId) params.set('api_id', options.apiId.toString())
    if (options.queryId) params.set('query_id', options.queryId.toString())
    if (options.includeOutput) params.set('include_output', 'true')

    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/request_history?${params.toString()}`
    )
  }

  // ========== Functions ==========

  /**
   * Bulk insert multiple records
   * @param allowIdField - If true, allows setting custom ID values in records
   */
  async bulkCreateTableContent(
    tableId: number,
    records: Record<string, unknown>[],
    datasource?: string,
    allowIdField = false
  ): Promise<ApiResponse<Record<string, unknown>[]>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/bulk?${this.branchParam}`,
      { allow_id_field: allowIdField, items: records }, // eslint-disable-line camelcase
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  /**
   * Call a live API endpoint
   * @param canonical - The API group canonical ID (e.g., "QV7RcVYt")
   * @param endpointPath - The endpoint path (e.g., "/auth/login")
   * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
   * @param body - Request body (for POST/PUT/PATCH)
   * @param headers - Additional headers (e.g., Authorization token)
   */
  async callLiveApi(
    canonical: string,
    endpointPath: string,
    method: string = 'GET',
    body?: Record<string, unknown>,
    headers?: Record<string, string>
  ): Promise<ApiResponse<unknown>> {
    const url = `${this.profile.instance_origin}/api:${canonical}:${this.branch}${endpointPath}`

    const requestHeaders: Record<string, string> = {
      accept: 'application/json',
      ...headers,
    }

    let requestBody: string | undefined
    if (body) {
      requestHeaders['Content-Type'] = 'application/json'
      requestBody = JSON.stringify(body)
    }

    try {
      const response = await fetch(url, {
        body: requestBody,
        headers: requestHeaders,
        method,
      })

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`
        try {
          const errorData = await response.json()
          errorMessage = errorData.message || errorData.error || errorMessage
        } catch {
          // Ignore JSON parse error
        }

        return {
          error: errorMessage,
          ok: false,
          status: response.status,
        }
      }

      const data = await response.json()
      return {
        data,
        ok: true,
        status: response.status,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        ok: false,
        status: 0,
      }
    }
  }

  async createAddon(xanoscript: string): Promise<ApiResponse<XanoApiAddon>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/addon?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createApiEndpoint(xanoscript: string, apiGroupId: number): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api?${this.branchParam}&include_xanoscript=true`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createApiGroup(xanoscript: string): Promise<ApiResponse<XanoApiGroup>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/apigroup?${this.branchParam}&include_xanoscript=true`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createDataSource(label: string, color: string): Promise<ApiResponse<XanoDataSource>> {
    return apiRequest<XanoDataSource>(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/datasource`,
      { color, label }
    )
  }

  // ========== API Groups ==========

  async createFunction(xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createMiddleware(xanoscript: string): Promise<ApiResponse<XanoApiMiddleware>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/middleware?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== API Endpoints ==========

  /**
   * Create object by type
   */
  async createObject(type: XanoObjectType, xanoscript: string, options?: { apigroup_id?: number }): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'addon': {
        return this.createAddon(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'api_endpoint': {
        if (!options?.apigroup_id) {
          return { error: 'apigroup_id is required to create an API endpoint', ok: false, status: 400 }
        }

        return this.createApiEndpoint(xanoscript, options.apigroup_id) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'api_group': {
        return this.createApiGroup(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'function': {
        return this.createFunction(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'middleware': {
        return this.createMiddleware(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table': {
        return this.createTable(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table_trigger': {
        return this.createTableTrigger(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'task': {
        return this.createTask(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'workflow_test': {
        return this.createWorkflowTest(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  async createTable(xanoscript: string): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  /**
   * Create a new record in a table
   * Note: Password fields are automatically hashed by Xano
   */
  async createTableContent(tableId: number, data: Record<string, unknown>, datasource?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content?${this.branchParam}`,
      data,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async createTableTrigger(xanoscript: string): Promise<ApiResponse<XanoApiTableTrigger>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/trigger?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createTask(xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/task?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createWorkflowTest(xanoscript: string): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/workflow_test?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteAddon(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/addon/${id}?${this.branchParam}`
    )
  }

  // ========== Tables ==========

  async deleteApiEndpoint(apiGroupId: number, id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api/${id}?${this.branchParam}`
    )
  }

  async deleteApiGroup(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${id}?${this.branchParam}`
    )
  }

  async deleteDataSource(label: string): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/datasource/${encodeURIComponent(label)}`
    )
  }

  async deleteFunction(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`
    )
  }

  async deleteMiddleware(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/middleware/${id}?${this.branchParam}`
    )
  }

  /**
   * Delete object by type and ID
   * @param type Object type
   * @param id Object ID
   * @param options Additional options (apigroup_id required for api_endpoint)
   */
  async deleteObject(
    type: XanoObjectType,
    id: number,
    options?: { apigroup_id?: number }
  ): Promise<ApiResponse<void>> {
    switch (type) {
      case 'addon': {
        return this.deleteAddon(id)
      }

      case 'api_endpoint': {
        if (!options?.apigroup_id) {
          return { error: 'apigroup_id is required for deleting API endpoints', ok: false, status: 0 }
        }

        return this.deleteApiEndpoint(options.apigroup_id, id)
      }

      case 'api_group': {
        return this.deleteApiGroup(id)
      }

      case 'function': {
        return this.deleteFunction(id)
      }

      case 'middleware': {
        return this.deleteMiddleware(id)
      }

      case 'table': {
        return this.deleteTable(id)
      }

      case 'table_trigger': {
        return this.deleteTableTrigger(id)
      }

      case 'task': {
        return this.deleteTask(id)
      }

      case 'workflow_test': {
        return this.deleteWorkflowTest(id)
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  // ========== Tasks ==========

  async deleteTable(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}`
    )
  }

  /**
   * Delete a record by primary key
   */
  async deleteTableContent(tableId: number, pk: number | string, datasource?: string): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/${encodeURIComponent(pk)}?${this.branchParam}`,
      undefined,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async deleteTableTrigger(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/trigger/${id}?${this.branchParam}`
    )
  }

  async deleteTask(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`
    )
  }

  async deleteWorkflowTest(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/workflow_test/${id}?${this.branchParam}`
    )
  }

  async getAddon(id: number): Promise<ApiResponse<XanoApiAddon>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/addon/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getApiEndpoint(id: number, apiGroupId?: number): Promise<ApiResponse<XanoApiEndpoint>> {
    // If apiGroupId is provided, use the full path (required by API)
    if (apiGroupId) {
      return apiRequest(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api/${id}?${this.branchParam}&include_xanoscript=true`
      )
    }

    // Fallback: list all endpoints to find the apigroup_id
    const endpointsResponse = await this.listApiEndpoints(1, 1000)
    if (!endpointsResponse.ok || !endpointsResponse.data?.items) {
      return { error: 'Unable to locate request.', ok: false, status: 404 }
    }

    // Find the endpoint to get its apigroup_id
    const endpoint = endpointsResponse.data.items.find((e: XanoApiEndpoint) => e.id === id)
    if (!endpoint) {
      return { error: 'Unable to locate request.', ok: false, status: 404 }
    }

    // Fetch with the proper URL using the apigroup_id
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${endpoint.apigroup_id}/api/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getApiGroup(id: number): Promise<ApiResponse<XanoApiGroup>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  /**
   * Get detailed info about an API group including canonical ID
   */
  async getApiGroupWithCanonical(groupId: number): Promise<ApiResponse<XanoApiGroup & { canonical?: string }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${groupId}?${this.branchParam}`
    )
  }

  async getFunction(id: number): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  // ========== Table Trigger CRUD ==========

  /**
   * Get function request history
   */
  async getFunctionHistory(
    functionId: number,
    options: { includeOutput?: boolean; page?: number; perPage?: number } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    const params = new URLSearchParams()
    params.set('branch', this.branch)
    if (options.page) params.set('page', options.page.toString())
    if (options.perPage) params.set('per_page', options.perPage.toString())
    if (options.includeOutput) params.set('include_output', 'true')

    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function/${functionId}/request_history?${params.toString()}`
    )
  }

  async getMiddleware(id: number): Promise<ApiResponse<XanoApiMiddleware>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/middleware/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  /**
   * Get middleware request history
   */
  async getMiddlewareHistory(
    middlewareId: number,
    options: { includeOutput?: boolean; page?: number; perPage?: number } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    const params = new URLSearchParams()
    params.set('branch', this.branch)
    if (options.page) params.set('page', options.page.toString())
    if (options.perPage) params.set('per_page', options.perPage.toString())
    if (options.includeOutput) params.set('include_output', 'true')

    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/middleware/${middlewareId}/request_history?${params.toString()}`
    )
  }

  /**
   * Get object by type and ID
   */
  async getObject(type: XanoObjectType, id: number): Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>> {
    switch (type) {
      case 'addon': {
        return this.getAddon(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'api_endpoint': {
        return this.getApiEndpoint(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'api_group': {
        return this.getApiGroup(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'function': {
        return this.getFunction(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'middleware': {
        return this.getMiddleware(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'table': {
        return this.getTable(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'table_trigger': {
        return this.getTableTrigger(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'task': {
        return this.getTask(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'workflow_test': {
        return this.getWorkflowTest(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  // ========== Addon CRUD ==========

  async getTable(id: number): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  /**
   * Get a single record by primary key
   */
  async getTableContent(tableId: number, pk: number | string, datasource?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/${encodeURIComponent(pk)}?${this.branchParam}`,
      undefined,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async getTableTrigger(id: number): Promise<ApiResponse<XanoApiTableTrigger>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/trigger/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getTask(id: number): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  // ========== Middleware CRUD ==========

  /**
   * Get task request history
   */
  async getTaskHistory(
    taskId: number,
    options: { includeOutput?: boolean; page?: number; perPage?: number } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    const params = new URLSearchParams()
    params.set('branch', this.branch)
    if (options.page) params.set('page', options.page.toString())
    if (options.perPage) params.set('per_page', options.perPage.toString())
    if (options.includeOutput) params.set('include_output', 'true')

    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task/${taskId}/request_history?${params.toString()}`
    )
  }

  /**
   * Get trigger request history
   */
  async getTriggerHistory(
    triggerId: number,
    options: { includeOutput?: boolean; page?: number; perPage?: number } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    const params = new URLSearchParams()
    params.set('branch', this.branch)
    if (options.page) params.set('page', options.page.toString())
    if (options.perPage) params.set('per_page', options.perPage.toString())
    if (options.includeOutput) params.set('include_output', 'true')

    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/trigger/${triggerId}/request_history?${params.toString()}`
    )
  }

  async getWorkflowTest(id: number): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/workflow_test/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  /**
   * List addons
   */
  async listAddons(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiAddon[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/addon?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listApiEndpoints(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiEndpoint[] }>> {
    // Always fetch per API group to ensure apigroup_id is captured
    // The workspace-level /api endpoint may not return apigroup_id
    const groupsResult = await this.listApiGroups(1, 1000)
    if (!groupsResult.ok || !groupsResult.data?.items) {
      // Fallback to workspace-level listing if groups fail
      return apiRequest<{ items: XanoApiEndpoint[] }>(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/api?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
      )
    }

    const allEndpoints: XanoApiEndpoint[] = []

    for (const group of groupsResult.data.items) {
      // eslint-disable-next-line no-await-in-loop -- Sequential API calls per group
      const groupEndpoints = await apiRequest<{ items: XanoApiEndpoint[] }>(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/apigroup/${group.id}/api?${this.branchParam}&page=1&per_page=1000&include_xanoscript=true`
      )

      if (groupEndpoints.ok && groupEndpoints.data?.items) {
        for (const ep of groupEndpoints.data.items) {
          // Ensure apigroup_id is set (required for updates)
          allEndpoints.push({ ...ep, apigroup_id: group.id }) // eslint-disable-line camelcase
        }
      }
    }

    return {
      data: { items: allEndpoints },
      ok: true,
      status: 200,
    }
  }

  async listApiGroups(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiGroup[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listBranches(): Promise<ApiResponse<XanoApiBranch[]>> {
    return apiRequest<XanoApiBranch[]>(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/branch`
    )
  }

  // ========== Generic object operations ==========

  async listDataSources(): Promise<ApiResponse<XanoDataSource[]>> {
    return apiRequest<XanoDataSource[]>(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/datasource`
    )
  }

  async listFunctions(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiFunction[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listMiddlewares(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiMiddleware[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/middleware?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  /**
   * List records from a table
   */
  async listTableContent(
    tableId: number,
    page = 1,
    perPage = 100,
    datasource?: string
  ): Promise<ApiResponse<{ curPage: number; items: Record<string, unknown>[]; nextPage: null | number; prevPage: null | number }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content?${this.branchParam}&page=${page}&per_page=${perPage}`,
      undefined,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async listTables(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTable[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  // ========== Table Content (Data) ==========

  /**
   * List all table triggers in the workspace
   */
  async listTableTriggers(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTableTrigger[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/trigger?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listTasks(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTask[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listWorkflowTests(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiWorkflowTest[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/workflow_test?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  /**
   * Search request history with filters
   * @param filter Search filters
   * @param options Additional options
   */
  async searchRequestHistory(
    filter: {
      'created_at|<|'?: number   // Timestamp in ms (before)
      'created_at|>|'?: number   // Timestamp in ms (after)
      'duration|<|'?: number     // Duration in seconds
      'duration|>|'?: number     // Duration in seconds
      'status'?: number          // Exact status code
      'status|<|'?: number       // Status less than
      'status|>|'?: number       // Status greater than
    },
    options: {
      apiId?: number
      includeOutput?: boolean
      page?: number
      perPage?: number
      queryId?: number
      sort?: { [key: string]: 'asc' | 'desc' }
    } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    const params = new URLSearchParams()
    params.set('branch', this.branch)
    if (options.page) params.set('page', options.page.toString())
    if (options.perPage) params.set('per_page', options.perPage.toString())
    if (options.apiId) params.set('api_id', options.apiId.toString())
    if (options.queryId) params.set('query_id', options.queryId.toString())
    if (options.includeOutput) params.set('include_output', 'true')

    const body: { filter?: typeof filter; sort?: typeof options.sort } = {}
    if (Object.keys(filter).length > 0) body.filter = filter
    if (options.sort) body.sort = options.sort

    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/request_history/search?${params.toString()}`,
      body
    )
  }

  /**
   * Search/filter records in a table
   *
   * Search operators (use as object keys):
   * - field: exact match
   * - field|>: greater than
   * - field|<: less than
   * - field|>=: greater or equal
   * - field|<=: less or equal
   * - field|!=: not equal
   * - field|in: value in array
   * - field|not in: value not in array
   * - field|>|or: greater than with OR logic
   *
   * @param tableId Table ID
   * @param options Search options
   */
  async searchTableContent(
    tableId: number,
    options: {
      datasource?: string
      page?: number
      perPage?: number
      search?: Record<string, unknown> | Record<string, unknown>[]
      sort?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[]
    } = {}
  ): Promise<ApiResponse<{ curPage: number; items: Record<string, unknown>[]; itemsReceived: number; itemsTotal: number; nextPage: null | number; offset: number; pageTotal: number; prevPage: null | number }>> {
    const body: {
      page?: number
      per_page?: number
      search?: Record<string, unknown> | Record<string, unknown>[]
      sort?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[]
    } = {}

    if (options.page) body.page = options.page
    if (options.perPage) body.per_page = options.perPage // eslint-disable-line camelcase
    if (options.search) body.search = options.search
    if (options.sort) body.sort = options.sort

    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/search?branch=${this.branch}`,
      body,
      'application/json',
      this.datasourceHeaders(options.datasource)
    )
  }

  async updateAddon(id: number, xanoscript: string): Promise<ApiResponse<XanoApiAddon>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/addon/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateApiEndpoint(apiGroupId: number, id: number, xanoscript: string): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateFunction(id: number, xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== Request History ==========

  async updateMiddleware(id: number, xanoscript: string): Promise<ApiResponse<XanoApiMiddleware>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/middleware/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  /**
   * Update object by type and ID
   * @param type Object type
   * @param id Object ID
   * @param xanoscript XanoScript content
   * @param options Additional options (apigroup_id for api_endpoint, table_id for table_trigger)
   */
  async updateObject(
    type: XanoObjectType,
    id: number,
    xanoscript: string,
    options?: { apigroup_id?: number; table_id?: number }
  ): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'addon': {
        return this.updateAddon(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'api_endpoint': {
        if (!options?.apigroup_id) {
          return { error: 'apigroup_id is required for updating API endpoints. Run "xano pull --sync" to refresh metadata.', ok: false, status: 0 }
        }

        return this.updateApiEndpoint(options.apigroup_id, id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'function': {
        return this.updateFunction(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'middleware': {
        return this.updateMiddleware(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table': {
        return this.updateTable(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table_trigger': {
        return this.updateTableTrigger(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'task': {
        return this.updateTask(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'workflow_test': {
        return this.updateWorkflowTest(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  async updateTable(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  /**
   * Update an existing record by primary key
   */
  async updateTableContent(tableId: number, pk: number | string, data: Record<string, unknown>, datasource?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/${encodeURIComponent(pk)}?${this.branchParam}`,
      data,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async updateTableTrigger(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTableTrigger>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/trigger/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateTask(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== Live API Calls ==========

  async updateWorkflowTest(id: number, xanoscript: string): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/workflow_test/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  /**
   * Get headers for datasource targeting
   */
  private datasourceHeaders(datasource?: string): Record<string, string> | undefined {
    return datasource ? { 'x-data-source': datasource } : undefined
  }
}

/**
 * Create API client from project config
 */
export function createApiClient(
  instanceOrigin: string,
  accessToken: string,
  workspaceId: number,
  branch: string
): XanoApi {
  const profile: XanoProfile = {
    access_token: accessToken, // eslint-disable-line camelcase
    instance_origin: instanceOrigin, // eslint-disable-line camelcase
  }

  return new XanoApi(profile, workspaceId, branch)
}

/**
 * Create API client from profile name
 */
export function createApiClientFromProfile(
  profileName: string | undefined,
  workspaceId: number,
  branch: string
): null | XanoApi {
  const profile = getProfile(profileName)
  if (!profile) return null

  return new XanoApi(profile, workspaceId, branch)
}
