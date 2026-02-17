/**
 * Init Engine - Core initialization logic with event-driven architecture
 *
 * Based on docs/commands/init.draft.md (CANDIDATE spec)
 */

import type { NamingMode, XanoPaths } from '../types.js'

// ========== Configuration Data Object ==========

export interface InitConfig {
  // Authentication
  accessToken?: string
  branch?: string          // Default branch

  datasource?: string      // Default datasource
  datasources?: Record<string, 'locked' | 'read-only' | 'read-write'>
  // Instance
  instance?: string        // User input: URL or short name
  instanceDisplay?: string // Resolved: display name

  instanceName?: string    // Resolved: canonical ID (a1b2-c3d4-e5f6)
  instanceOrigin?: string  // Resolved: https://a1b2-c3d4-e5f6.xano.io
  // Configuration
  naming?: NamingMode

  paths?: XanoPaths
  profile?: string
  // Metadata - tracks where each value came from
  sources: Record<string, 'api' | 'autodiscovery' | 'config.json' | 'credentials.yaml' | 'default' | 'flag' | 'prompt' | 'xano.json'>
  // Project
  workspace?: number       // Workspace ID only

  workspaceName?: string   // Derived from API
}

// ========== Event Types (from draft spec) ==========

export interface MissingDataEvent {
  description: string
  field: string
  required: boolean
  suggestions?: Array<{ isDefault?: boolean; label: string; value: string; }>
}

export interface ConflictEvent {
  field: string
  recommendation: string
  sources: Array<{ source: string; value: unknown }>
}

export interface ValidationErrorEvent {
  error: string
  field: string
  suggestions?: string[]
  value: unknown
}

export interface ProgressEvent {
  message?: string
  status: 'complete' | 'error' | 'pending' | 'running'
  step: string
}

export interface CompleteEvent {
  config: InitConfig
  filesCreated: string[]
  preview?: FilePreview[]
  success: boolean
  warnings: string[]
}

export interface FilePreview {
  action: 'create' | 'skip' | 'unchanged' | 'update'
  content: Record<string, unknown>
  path: string
}

// ========== Frontend Interface (from draft spec) ==========

export interface InitFrontend {
  onComplete(event: CompleteEvent): void
  onConflict(event: ConflictEvent): Promise<'abort' | 'keep' | 'override'>
  onMissingData(event: MissingDataEvent): Promise<string | undefined>
  onProgress(event: ProgressEvent): void
  onValidationError(event: ValidationErrorEvent): Promise<string | undefined>
}

// ========== API Response Types ==========

export interface Instance {
  display: string
  id: string
  meta_api: string
  name: string
}

export interface Workspace {
  id: number
  name: string
}

export interface Branch {
  backup: boolean
  label: string
  live?: boolean
}

// ========== Init Engine ==========

export interface InitEngineOptions {
  dryRun?: boolean
  force?: boolean
  frontend: InitFrontend
  projectRoot: string
}

export class InitEngine {
  private config: InitConfig = { sources: {} }
  private dryRun: boolean
  private force: boolean
  private frontend: InitFrontend
  private projectRoot: string

  constructor(options: InitEngineOptions) {
    this.frontend = options.frontend
    this.projectRoot = options.projectRoot
    this.dryRun = options.dryRun ?? false
    this.force = options.force ?? false
  }

  // ========== Getters ==========

  complete(event: Omit<CompleteEvent, 'config'>): void {
    this.frontend.onComplete({
      ...event,
      config: this.config,
    })
  }

  async fetchBranches(accessToken: string, origin: string, workspaceId: number): Promise<Branch[]> {
    const response = await fetch(`${origin}/api:meta/workspace/${workspaceId}/branch`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'xano-cli',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch branches: ${response.status}`)
    }

    const data = await response.json() as Array<{ backup?: boolean; label: string; live?: boolean; }>
    return data.map(b => ({
      backup: b.backup ?? false,
      label: b.label,
      live: b.live,
    }))
  }

  async fetchInstances(accessToken: string, origin: string): Promise<Instance[]> {
    const response = await fetch(`${origin}/api:meta/instance`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'xano-cli',
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid access token.')
      }

      throw new Error(`Failed to fetch instances: ${response.status}`)
    }

    const data = await response.json() as Array<{ display: string; id?: string; meta_api: string; name: string; }>
    return data.map(i => ({
      display: i.display,
      id: i.id || i.name,
      meta_api: i.meta_api, // eslint-disable-line camelcase
      name: i.name,
    }))
  }

  async fetchWorkspaces(accessToken: string, origin: string): Promise<Workspace[]> {
    const response = await fetch(`${origin}/api:meta/workspace`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'xano-cli',
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch workspaces: ${response.status}`)
    }

    const data = await response.json() as Array<{ id: number; name: string }>
    return data.map(w => ({ id: w.id, name: w.name }))
  }

  /**
   * Find workspace by name (case-insensitive)
   */
  findWorkspaceByName(workspaces: Workspace[], name: string): undefined | Workspace {
    // Try exact match first
    const exact = workspaces.find(w => w.name === name)
    if (exact) return exact

    // Try case-insensitive
    return workspaces.find(w => w.name.toLowerCase() === name.toLowerCase())
  }

  getConfig(): InitConfig {
    return { ...this.config }
  }

  // ========== Setters ==========

  getProjectRoot(): string {
    return this.projectRoot
  }

  // ========== Event Dispatchers ==========

  getValue<T>(field: keyof Omit<InitConfig, 'sources'>): T | undefined {
    return this.config[field] as T | undefined
  }

  async handleValidationError(event: ValidationErrorEvent): Promise<string | undefined> {
    return this.frontend.onValidationError(event)
  }

  hasValue(field: keyof Omit<InitConfig, 'sources'>): boolean {
    return this.config[field] !== undefined
  }

  isDryRun(): boolean {
    return this.dryRun
  }

  isForce(): boolean {
    return this.force
  }

  // ========== API Methods ==========

  progress(step: string, status: ProgressEvent['status'], message?: string): void {
    this.frontend.onProgress({ message, status, step })
  }

  async requestData(event: MissingDataEvent): Promise<string | undefined> {
    return this.frontend.onMissingData(event)
  }

  /**
   * Resolve branch, defaulting to live if not found
   */
  resolveBranchLabel(branches: Branch[], requested?: string): { branch: string; warning?: string } {
    const nonBackup = branches.filter(b => !b.backup)
    const liveBranch = nonBackup.find(b => b.live)?.label || nonBackup[0]?.label || 'main'

    if (!requested) {
      return { branch: liveBranch }
    }

    const found = nonBackup.find(b => b.label === requested)
    if (found) {
      return { branch: found.label }
    }

    return {
      branch: liveBranch,
      warning: `Branch "${requested}" not found. Using "${liveBranch}" instead.`,
    }
  }

  // ========== Validation Helpers ==========

  async resolveConflict(event: ConflictEvent): Promise<'abort' | 'keep' | 'override'> {
    if (this.force) {
      return 'override'
    }

    return this.frontend.onConflict(event)
  }

  setValue(
    field: keyof Omit<InitConfig, 'sources'>,
    value: unknown,
    source: InitConfig['sources'][string]
  ): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.config as any)[field] = value
    this.config.sources[field] = source
  }

  async validateAccessToken(token: string): Promise<boolean> {
    try {
      const response = await fetch('https://app.xano.com/api:meta/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'xano-cli',
        },
      })
      return response.ok
    } catch {
      return false
    }
  }
}
