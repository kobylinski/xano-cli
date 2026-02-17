/**
 * Credentials Manager - Handles ~/.xano/credentials.yaml with TitleCase profile names
 */

import * as yaml from 'js-yaml'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Internal application type (camelCase)
export interface XanoCredentialProfile {
  accessToken: string
  accountOrigin: string
  branch?: string
  instanceOrigin: string
  name: string
  workspace?: number
}

// YAML file structure (snake_case for VSCode compatibility)
interface CredentialsYaml {
  default?: string
  profiles: Record<string, {
    access_token: string
    account_origin: string
    branch?: string
    instance_origin: string
    workspace?: number
  }>
}

/**
 * Convert display name to TitleCase profile name
 */
export function toTitleCase(displayName: string): string {
  return displayName
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}

/**
 * Credentials manager with abstraction over YAML format
 */
export class CredentialsManager {
  private defaultProfile: string | undefined
  private path: string
  private profiles: Map<string, XanoCredentialProfile>

  private constructor(path: string) {
    this.path = path
    this.profiles = new Map()
  }

  /**
   * Load credentials from YAML file
   */
  static load(path?: string): CredentialsManager {
    const credentialsPath = path ?? join(homedir(), '.xano', 'credentials.yaml')
    const manager = new CredentialsManager(credentialsPath)

    if (!existsSync(credentialsPath)) {
      return manager
    }

    try {
      const content = readFileSync(credentialsPath, 'utf8')
      const data = yaml.load(content) as CredentialsYaml | null

      if (!data?.profiles) {
        return manager
      }

      manager.defaultProfile = data.default

      for (const [name, profile] of Object.entries(data.profiles)) {
        manager.profiles.set(name, {
          accessToken: profile.access_token,
          accountOrigin: profile.account_origin,
          branch: profile.branch,
          instanceOrigin: profile.instance_origin,
          name,
          workspace: profile.workspace,
        })
      }
    } catch {
      // Return empty manager on parse error
    }

    return manager
  }

  /**
   * Add or update a profile
   */
  add(profile: XanoCredentialProfile): void {
    this.profiles.set(profile.name, profile)
  }

  /**
   * Get a profile by name
   */
  get(name: string): undefined | XanoCredentialProfile {
    return this.profiles.get(name)
  }

  /**
   * Get the default profile
   */
  getDefault(): string | undefined {
    return this.defaultProfile
  }

  /**
   * Get the default profile object
   */
  getDefaultProfile(): undefined | XanoCredentialProfile {
    if (!this.defaultProfile) return undefined
    return this.profiles.get(this.defaultProfile)
  }

  /**
   * List all profile names
   */
  listNames(): string[] {
    return [...this.profiles.keys()]
  }

  /**
   * List all profiles
   */
  listProfiles(): XanoCredentialProfile[] {
    return [...this.profiles.values()]
  }

  /**
   * Remove a profile
   */
  remove(name: string): boolean {
    const deleted = this.profiles.delete(name)
    if (deleted && this.defaultProfile === name) {
      this.defaultProfile = undefined
    }

    return deleted
  }

  /**
   * Save credentials to YAML file
   */
  save(): void {
    const dir = join(homedir(), '.xano')
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const yamlData: CredentialsYaml = {
      profiles: {},
    }

    if (this.defaultProfile) {
      yamlData.default = this.defaultProfile
    }

    for (const [name, profile] of this.profiles) {
      yamlData.profiles[name] = {
        access_token: profile.accessToken, // eslint-disable-line camelcase
        account_origin: profile.accountOrigin, // eslint-disable-line camelcase
        instance_origin: profile.instanceOrigin, // eslint-disable-line camelcase
        ...(profile.workspace !== undefined && { workspace: profile.workspace }),
        ...(profile.branch && { branch: profile.branch }),
      }
    }

    const content = yaml.dump(yamlData, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    })

    writeFileSync(this.path, content, 'utf8')
  }

  /**
   * Set the default profile
   */
  setDefault(name: string): void {
    if (!this.profiles.has(name)) {
      throw new Error(`Profile "${name}" not found`)
    }

    this.defaultProfile = name
  }
}

/**
 * Get credentials path
 */
export function getCredentialsPath(): string {
  return join(homedir(), '.xano', 'credentials.yaml')
}
