/**
 * Tasks API module
 */

import type { RequestHistoryItem, XanoApiTask } from '../types.js'

import { BaseApi } from './base.js'
import { apiRequest, ApiResponse } from './request.js'

export class TasksApi extends BaseApi {
  async create(xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/task?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async delete(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`
    )
  }

  async get(id: number): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getHistory(
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

  async list(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTask[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async update(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }
}
