/**
 * Xano Metadata API client
 * Handles all API calls to Xano
 */

import * as yaml from 'js-yaml'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type {
  XanoApiBranch,
  XanoApiEndpoint,
  XanoApiFunction,
  XanoApiGroup,
  XanoApiTable,
  XanoApiTask,
  XanoCredentials,
  XanoObjectType,
  XanoProfile,
} from './types.js'

const CREDENTIALS_PATH = path.join(os.homedir(), '.xano', 'credentials.yaml')

/**
 * Load credentials from ~/.xano/credentials.yaml
 */
export function loadCredentials(): null | XanoCredentials {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    return null
  }

  try {
    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8')
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
  contentType: string = 'application/json'
): Promise<ApiResponse<T>> {
  const url = `${profile.instance_origin}${endpoint}`

  const headers: Record<string, string> = {
    accept: 'application/json',
    Authorization: `Bearer ${profile.access_token}`,
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

  async createApiEndpoint(xanoscript: string): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/api?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== Functions ==========

  async createFunction(xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  /**
   * Create object by type
   */
  async createObject(type: XanoObjectType, xanoscript: string): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'api_endpoint': {
        return this.createApiEndpoint(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'function': {
        return this.createFunction(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table': {
        return this.createTable(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'task': {
        return this.createTask(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
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

  async createTask(xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/task?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteApiEndpoint(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/api/${id}?${this.branchParam}`
    )
  }

  // ========== API Groups ==========

  async deleteFunction(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`
    )
  }

  /**
   * Delete object by type and ID
   */
  async deleteObject(type: XanoObjectType, id: number): Promise<ApiResponse<void>> {
    switch (type) {
      case 'api_endpoint': {
        return this.deleteApiEndpoint(id)
      }

      case 'function': {
        return this.deleteFunction(id)
      }

      case 'table': {
        return this.deleteTable(id)
      }

      case 'task': {
        return this.deleteTask(id)
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  // ========== API Endpoints ==========

  async deleteTable(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}`
    )
  }

  async deleteTask(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`
    )
  }

  async getApiEndpoint(id: number): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/api/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getApiGroup(id: number): Promise<ApiResponse<XanoApiGroup>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${id}?${this.branchParam}`
    )
  }

  async getFunction(id: number): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  // ========== Tables ==========

  /**
   * Get object by type and ID
   */
  async getObject(type: XanoObjectType, id: number): Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>> {
    switch (type) {
      case 'api_endpoint': {
        return this.getApiEndpoint(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'function': {
        return this.getFunction(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'table': {
        return this.getTable(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'task': {
        return this.getTask(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  async getTable(id: number): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getTask(id: number): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async listApiEndpoints(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiEndpoint[] }>> {
    // First try workspace-level API listing
    const result = await apiRequest<{ items: XanoApiEndpoint[] }>(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/api?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )

    // If that works, return it
    if (result.ok && result.data?.items && result.data.items.length > 0) {
      return result
    }

    // Otherwise, try fetching per group
    const groupsResult = await this.listApiGroups(1, 1000)
    if (!groupsResult.ok || !groupsResult.data?.items) {
      return result // Return original error
    }

    const allEndpoints: XanoApiEndpoint[] = []

    for (const group of groupsResult.data.items) {
      const groupEndpoints = await apiRequest<{ items: XanoApiEndpoint[] }>(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/apigroup/${group.id}/api?${this.branchParam}&page=1&per_page=1000&include_xanoscript=true`
      )

      if (groupEndpoints.ok && groupEndpoints.data?.items) {
        for (const ep of groupEndpoints.data.items) {
          allEndpoints.push({ ...ep, apigroup_id: group.id })
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
      `/api:meta/workspace/${this.workspaceId}/apigroup?${this.branchParam}&page=${page}&per_page=${perPage}`
    )
  }

  // ========== Tasks ==========

  async listBranches(): Promise<ApiResponse<XanoApiBranch[]>> {
    return apiRequest<XanoApiBranch[]>(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/branch`
    )
  }

  async listFunctions(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiFunction[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listTables(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTable[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listTasks(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTask[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async updateApiEndpoint(id: number, xanoscript: string): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/api/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== Generic object operations ==========

  async updateFunction(id: number, xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  /**
   * Update object by type and ID
   */
  async updateObject(type: XanoObjectType, id: number, xanoscript: string): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'api_endpoint': {
        return this.updateApiEndpoint(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'function': {
        return this.updateFunction(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table': {
        return this.updateTable(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'task': {
        return this.updateTask(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
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

  async updateTask(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
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
    access_token: accessToken,
    instance_origin: instanceOrigin,
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
