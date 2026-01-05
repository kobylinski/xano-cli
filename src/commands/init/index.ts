import { Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import inquirer from 'inquirer'
import {
  findProjectRoot,
  loadXanoJson,
  saveXanoJson,
  loadLocalConfig,
  saveLocalConfig,
  createLocalConfig,
  getDefaultPaths,
  ensureXanoDir,
  getXanoDirPath,
  getConfigJsonPath,
  getXanoJsonPath,
} from '../../lib/project.js'
import {
  getProfile,
  listProfileNames,
  getDefaultProfileName,
  XanoApi,
} from '../../lib/api.js'
import type { XanoProjectConfig, XanoLocalConfig } from '../../lib/types.js'

export default class Init extends Command {
  static description = 'Initialize xano project in current directory'

  static examples = [
    '<%= config.bin %> init',
    '<%= config.bin %> init --branch v2',
    '<%= config.bin %> init --profile my-profile --branch live',
  ]

  static flags = {
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    branch: Flags.string({
      char: 'b',
      description: 'Xano branch to use',
      env: 'XANO_BRANCH',
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Force reinitialize',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Init)

    const projectRoot = findProjectRoot() || process.cwd()

    const hasXanoDir = fs.existsSync(getXanoDirPath(projectRoot))
    const hasConfigJson = fs.existsSync(getConfigJsonPath(projectRoot))
    const hasXanoJson = fs.existsSync(getXanoJsonPath(projectRoot))

    // Case 1: .xano/ exists with config.json - already initialized
    if (hasConfigJson && !flags.force) {
      const config = loadLocalConfig(projectRoot)

      // If xano.json doesn't exist, create it from config.json
      if (!hasXanoJson && config) {
        this.log('Creating xano.json from .xano/config.json...')
        this.createXanoJsonFromConfig(projectRoot, config)
      }

      this.log(`Already initialized.`)
      this.log(`  Workspace: ${config?.workspaceName}`)
      this.log(`  Branch: ${config?.branch}`)
      this.log('')
      this.log('Use --force to reinitialize.')
      this.log("Run 'xano sync' to update object mappings.")
      return
    }

    // Case 2: xano.json exists but .xano/ doesn't - use template, just select branch
    if (hasXanoJson && !hasConfigJson) {
      const projectConfig = loadXanoJson(projectRoot)
      if (projectConfig) {
        this.log(`Found xano.json template.`)
        this.log(`  Workspace: ${projectConfig.workspace}`)
        this.log('')
        await this.initFromTemplate(projectRoot, projectConfig, flags)
        return
      }
    }

    // Case 3: Neither exists - full interactive setup
    if (!hasXanoJson && !hasConfigJson) {
      this.log('No existing configuration found. Starting interactive setup...\n')
      await this.fullInteractiveSetup(projectRoot, flags)
      return
    }

    // Case 4: Force reinit
    if (flags.force) {
      const projectConfig = loadXanoJson(projectRoot)
      if (projectConfig) {
        await this.initFromTemplate(projectRoot, projectConfig, flags)
      } else {
        await this.fullInteractiveSetup(projectRoot, flags)
      }
      return
    }
  }

  private createXanoJsonFromConfig(projectRoot: string, config: XanoLocalConfig): void {
    const projectConfig: XanoProjectConfig = {
      instance: config.instanceName,
      workspace: config.workspaceName,
      workspaceId: config.workspaceId,
      paths: config.paths || getDefaultPaths(),
    }
    saveXanoJson(projectRoot, projectConfig)
    this.log('Created xano.json\n')
  }

  private async initFromTemplate(
    projectRoot: string,
    projectConfig: XanoProjectConfig,
    flags: { profile?: string; branch?: string }
  ): Promise<void> {
    this.log(`Project: ${projectConfig.workspace}`)
    this.log(`Instance: ${projectConfig.instance}`)

    // Select profile
    const profileName = await this.selectProfile(flags.profile)
    if (!profileName) {
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    const profile = getProfile(profileName)
    if (!profile) {
      this.error(`Profile "${profileName}" not found.`)
    }

    this.log(`\nUsing profile: ${profileName}`)

    // Fetch and select branch
    const api = new XanoApi(profile, projectConfig.workspaceId, '')
    const branchesResponse = await api.listBranches()

    if (!branchesResponse.ok || !branchesResponse.data) {
      this.error(`Failed to fetch branches: ${branchesResponse.error}`)
    }

    const branch = await this.selectBranch(flags.branch, branchesResponse.data)

    // Create .xano/config.json
    const localConfig = createLocalConfig(projectConfig, branch)
    saveLocalConfig(projectRoot, localConfig)

    this.log(`\nInitialized .xano/config.json`)
    this.log(`  Branch: ${branch}`)
    this.log('')
    this.log("Run 'xano sync' to fetch objects from Xano.")
  }

  private async fullInteractiveSetup(
    projectRoot: string,
    flags: { profile?: string; branch?: string }
  ): Promise<void> {
    const profiles = listProfileNames()
    if (profiles.length === 0) {
      this.error('No profiles found. Run "xano profile:wizard" to create one.')
    }

    // Select profile
    const profileName = await this.selectProfile(flags.profile)
    if (!profileName) {
      this.error('No profile found.')
    }

    const profile = getProfile(profileName)
    if (!profile) {
      this.error(`Profile "${profileName}" not found.`)
    }

    this.log(`Using profile: ${profileName}\n`)

    // Fetch workspaces
    const response = await fetch(`${profile.instance_origin}/api:meta/workspace`, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${profile.access_token}`,
      },
    })

    if (!response.ok) {
      this.error(`Failed to fetch workspaces: ${response.status}`)
    }

    const workspaces = await response.json() as Array<{ id: number; name: string }>

    if (workspaces.length === 0) {
      this.error('No workspaces found.')
    }

    // Select workspace
    const { workspace } = await inquirer.prompt<{ workspace: { id: number; name: string } }>([
      {
        type: 'list',
        name: 'workspace',
        message: 'Select workspace:',
        choices: workspaces.map((w) => ({
          name: w.name,
          value: w,
        })),
      },
    ])

    // Extract instance name
    const instanceMatch = profile.instance_origin.match(/https?:\/\/([^./]+)/)
    const instance = instanceMatch ? instanceMatch[1] : profile.instance_origin

    // Create xano.json
    const projectConfig: XanoProjectConfig = {
      instance,
      workspace: workspace.name,
      workspaceId: workspace.id,
      paths: getDefaultPaths(),
    }
    saveXanoJson(projectRoot, projectConfig)
    this.log(`\nCreated xano.json`)

    // Fetch branches
    const api = new XanoApi(profile, workspace.id, '')
    const branchesResponse = await api.listBranches()

    if (!branchesResponse.ok || !branchesResponse.data) {
      this.error(`Failed to fetch branches: ${branchesResponse.error}`)
    }

    // Select branch
    const branch = await this.selectBranch(flags.branch, branchesResponse.data)

    // Create .xano/config.json
    const localConfig = createLocalConfig(projectConfig, branch)
    saveLocalConfig(projectRoot, localConfig)

    this.log(`Created .xano/config.json`)
    this.log(`  Workspace: ${workspace.name}`)
    this.log(`  Branch: ${branch}`)
    this.log('')
    this.log("Run 'xano sync' to fetch objects from Xano.")
  }

  private async selectProfile(flagProfile?: string): Promise<string | null> {
    if (flagProfile) {
      return flagProfile
    }

    const profiles = listProfileNames()
    if (profiles.length === 0) {
      return null
    }

    if (profiles.length === 1) {
      return profiles[0]
    }

    const defaultProfile = getDefaultProfileName()

    const { selectedProfile } = await inquirer.prompt<{ selectedProfile: string }>([
      {
        type: 'list',
        name: 'selectedProfile',
        message: 'Select profile:',
        choices: profiles.map((p) => ({
          name: p === defaultProfile ? `${p} (default)` : p,
          value: p,
        })),
        default: defaultProfile,
      },
    ])

    return selectedProfile
  }

  private async selectBranch(
    flagBranch: string | undefined,
    branches: Array<{ id: number; name: string; is_default: boolean; is_live: boolean }>
  ): Promise<string> {
    if (flagBranch) {
      const exists = branches.some((b) => b.name === flagBranch)
      if (!exists) {
        this.warn(`Branch "${flagBranch}" not found on Xano. Using anyway.`)
      }
      return flagBranch
    }

    if (branches.length === 0) {
      this.error('No branches found in workspace.')
    }

    if (branches.length === 1) {
      return branches[0].name
    }

    const { selectedBranch } = await inquirer.prompt<{ selectedBranch: string }>([
      {
        type: 'list',
        name: 'selectedBranch',
        message: 'Select Xano branch:',
        choices: branches.map((b) => {
          let label = b.name
          if (b.is_default) label += ' (default)'
          if (b.is_live) label += ' (live)'
          return {
            name: label,
            value: b.name,
          }
        }),
        default: branches.find((b) => b.is_default)?.name || branches[0].name,
      },
    ])

    return selectedBranch
  }
}
