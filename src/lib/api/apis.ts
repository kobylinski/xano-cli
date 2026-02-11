/**
 * API Groups and Endpoints module
 */

import type { OpenApiSpec, XanoApiEndpoint, XanoApiGroup } from '../types.js'

import { BaseApi } from './base.js'
import { apiRequest, ApiResponse } from './request.js'

export class ApisApi extends BaseApi {
  async createEndpoint(xanoscript: string, apiGroupId: number): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api?${this.branchParam}&include_xanoscript=true`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createGroup(xanoscript: string): Promise<ApiResponse<XanoApiGroup>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/apigroup?${this.branchParam}&include_xanoscript=true`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteEndpoint(apiGroupId: number, id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api/${id}?${this.branchParam}`
    )
  }

  async deleteGroup(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${id}?${this.branchParam}`
    )
  }

  async getEndpoint(id: number, apiGroupId?: number): Promise<ApiResponse<XanoApiEndpoint>> {
    // If apiGroupId is provided, use the full path (required by API)
    if (apiGroupId) {
      return apiRequest(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api/${id}?${this.branchParam}&include_xanoscript=true`
      )
    }

    // Fallback: list all endpoints to find the apigroup_id
    const endpointsResponse = await this.listEndpoints(1, 1000)
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

  async getEndpointOpenApi(apiGroupId: number, apiId: number): Promise<ApiResponse<OpenApiSpec>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api/${apiId}/openapi?${this.branchParam}`
    )
  }

  async getGroup(id: number): Promise<ApiResponse<XanoApiGroup>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getGroupOpenApi(apiGroupId: number): Promise<ApiResponse<OpenApiSpec>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/openapi?${this.branchParam}`
    )
  }

  async getGroupOpenApiByCanonical(canonical: string): Promise<ApiResponse<OpenApiSpec>> {
    const url = `${this.profile.instance_origin}/apispec:${canonical}?type=json`

    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${this.profile.access_token}`,
        },
      })

      if (!response.ok) {
        return {
          error: `HTTP ${response.status}`,
          ok: false,
          status: response.status,
        }
      }

      const data = await response.json() as OpenApiSpec
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

  async getGroupWithCanonical(groupId: number): Promise<ApiResponse<XanoApiGroup & { canonical?: string }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${groupId}?${this.branchParam}`
    )
  }

  async getWorkspaceOpenApi(): Promise<ApiResponse<OpenApiSpec>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/openapi?${this.branchParam}`
    )
  }

  /**
   * List all endpoints - fetches per API group to ensure apigroup_id is set
   * The workspace-level /api endpoint doesn't reliably return apigroup_id
   */
  async listEndpoints(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiEndpoint[] }>> {
    // Fetch all groups first
    const groupsResult = await this.listGroups(1, 1000)
    if (!groupsResult.ok || !groupsResult.data?.items) {
      // Fallback to workspace-level listing if groups fail
      return apiRequest<{ items: XanoApiEndpoint[] }>(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/api?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
      )
    }

    // Fetch endpoints for all groups in parallel for better performance
    const groupIds = groupsResult.data.items.map(g => g.id)
    const promises = groupIds.map(groupId =>
      apiRequest<{ items: XanoApiEndpoint[] }>(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/apigroup/${groupId}/api?${this.branchParam}&page=1&per_page=1000&include_xanoscript=true`
      ).then(response => ({ groupId, response }))
    )

    const results = await Promise.all(promises)
    const allEndpoints: XanoApiEndpoint[] = []

    for (const { groupId, response } of results) {
      if (response.ok && response.data?.items) {
        for (const ep of response.data.items) {
          allEndpoints.push({ ...ep, apigroup_id: groupId }) // eslint-disable-line camelcase
        }
      }
    }

    return {
      data: { items: allEndpoints },
      ok: true,
      status: 200,
    }
  }

  /**
   * List endpoints by fetching from each API group separately (sequential version)
   */
  async listEndpointsByGroup(groups: Array<{ id: number }>): Promise<ApiResponse<{ items: XanoApiEndpoint[] }>> {
    const allEndpoints: XanoApiEndpoint[] = []

    for (const group of groups) {
      // eslint-disable-next-line no-await-in-loop -- Sequential API calls per group
      const groupEndpoints = await apiRequest<{ items: XanoApiEndpoint[] }>(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/apigroup/${group.id}/api?${this.branchParam}&page=1&per_page=1000&include_xanoscript=true`
      )

      if (groupEndpoints.ok && groupEndpoints.data?.items) {
        for (const ep of groupEndpoints.data.items) {
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

  async listGroups(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiGroup[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async updateEndpoint(apiGroupId: number, id: number, xanoscript: string): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateGroup(id: number, xanoscript: string): Promise<ApiResponse<XanoApiGroup>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }
}
