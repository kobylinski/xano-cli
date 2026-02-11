/**
 * Base API class with common properties
 */

import type { XanoProfile } from '../types.js'

/**
 * Base class providing common API properties
 */
export class BaseApi {
  constructor(
    protected profile: XanoProfile,
    protected workspaceId: number,
    protected branch: string
  ) {}

  protected get branchParam(): string {
    return `branch=${encodeURIComponent(this.branch)}`
  }

  /**
   * Get headers for datasource targeting
   */
  protected datasourceHeaders(datasource?: string): Record<string, string> | undefined {
    return datasource ? { 'x-data-source': datasource } : undefined
  }
}
