/**
 * Workflow Tests API module
 */

import type { XanoApiWorkflowTest } from '../types.js'

import { BaseApi } from './base.js'
import { apiRequest, ApiResponse } from './request.js'

export class WorkflowTestsApi extends BaseApi {
  async create(xanoscript: string): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/workflow_test?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async delete(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/workflow_test/${id}?${this.branchParam}`
    )
  }

  async get(id: number): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/workflow_test/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async list(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiWorkflowTest[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/workflow_test?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async update(id: number, xanoscript: string): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/workflow_test/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }
}
