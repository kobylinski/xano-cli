/**
 * AI Objects API module (Agents, Tools, MCP Servers and their triggers)
 */

import type {
  XanoApiAgent,
  XanoApiAgentTrigger,
  XanoApiMcpServer,
  XanoApiMcpServerTrigger,
  XanoApiTool,
} from '../types.js'

import { BaseApi } from './base.js'
import { apiRequest, ApiResponse } from './request.js'

export class AIApi extends BaseApi {
  // ========== Agents ==========

  async createAgent(xanoscript: string): Promise<ApiResponse<XanoApiAgent>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/agent?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createAgentTrigger(xanoscript: string): Promise<ApiResponse<XanoApiAgentTrigger>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/agent/trigger?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== MCP Servers ==========

  async createMcpServer(xanoscript: string): Promise<ApiResponse<XanoApiMcpServer>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/mcp_server?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createMcpServerTrigger(xanoscript: string): Promise<ApiResponse<XanoApiMcpServerTrigger>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/mcp_server/trigger?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== Tools ==========

  async createTool(xanoscript: string): Promise<ApiResponse<XanoApiTool>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/tool?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteAgent(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/agent/${id}?${this.branchParam}`
    )
  }

  async deleteAgentTrigger(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/agent/trigger/${id}?${this.branchParam}`
    )
  }

  async deleteMcpServer(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/mcp_server/${id}?${this.branchParam}`
    )
  }

  async deleteMcpServerTrigger(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/mcp_server/trigger/${id}?${this.branchParam}`
    )
  }

  async deleteTool(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/tool/${id}?${this.branchParam}`
    )
  }

  async getAgent(id: number): Promise<ApiResponse<XanoApiAgent>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/agent/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getAgentTrigger(id: number): Promise<ApiResponse<XanoApiAgentTrigger>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/agent/trigger/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getMcpServer(id: number): Promise<ApiResponse<XanoApiMcpServer>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/mcp_server/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getMcpServerTrigger(id: number): Promise<ApiResponse<XanoApiMcpServerTrigger>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/mcp_server/trigger/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getTool(id: number): Promise<ApiResponse<XanoApiTool>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/tool/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async listAgents(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiAgent[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/agent?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listAgentTriggers(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiAgentTrigger[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/agent/trigger?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listMcpServers(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiMcpServer[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/mcp_server?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listMcpServerTriggers(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiMcpServerTrigger[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/mcp_server/trigger?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listTools(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTool[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/tool?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async updateAgent(id: number, xanoscript: string): Promise<ApiResponse<XanoApiAgent>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/agent/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateAgentTrigger(id: number, xanoscript: string): Promise<ApiResponse<XanoApiAgentTrigger>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/agent/trigger/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateMcpServer(id: number, xanoscript: string): Promise<ApiResponse<XanoApiMcpServer>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/mcp_server/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateMcpServerTrigger(id: number, xanoscript: string): Promise<ApiResponse<XanoApiMcpServerTrigger>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/mcp_server/trigger/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateTool(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTool>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/tool/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }
}
