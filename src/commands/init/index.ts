import { Args, Flags } from '@oclif/core'
import inquirer from 'inquirer'
import * as yaml from 'js-yaml'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { XanoProfile, XanoProjectConfig } from '../../lib/types.js'

import BaseCommand from '../../base-command.js'
import {
  getDefaultProfileName,
  getProfile,
  listProfileNames,
} from '../../lib/api.js'
import {
  createCliConfig,
  createLocalConfig,
  findProjectRoot,
  getConfigJsonPath,
  getDefaultPaths,
  getXanoJsonPath,
  isXanoGitignored,
  loadLocalConfig,
  loadXanoJson,
  saveCliConfig,
  saveLocalConfig,
  saveXanoJson,
} from '../../lib/project.js'

// Types for API responses
interface Instance {
  display: string
  id: string
  meta_api: string
  name: string
}

interface Workspace {
  id: number
  name: string
}

interface Branch {
  backup: boolean
  label: string
  live?: boolean
}

// Raw API response types (may have additional/optional fields)
interface RawBranch {
  backup?: boolean
  label: string
  live?: boolean
}

interface RawInstance {
  display: string
  id?: string
  meta_api: string
  name: string
}

interface RawWorkspace {
  id: number
  name: string
}

interface CredentialsFile {
  default?: string
  profiles: {
    [key: string]: Omit<XanoProfile, 'name'>
  }
}

const CREATE_NEW_PROFILE = '[CREATE_NEW]'

export default class Init extends BaseCommand {
  static args = {
    profileArg: Args.string({
      description: 'Profile name (for "project" subcommand)',
      required: false,
    }),
    subcommand: Args.string({
      description: 'Subcommand: "profile" or "project"',
      options: ['profile', 'project'],
      required: false,
    }),
  }
static description = 'Initialize xano project and/or profile'
static examples = [
    '<%= config.bin %> init                          # Full setup (profile + project)',
    '<%= config.bin %> init profile                  # Create/manage profiles only',
    '<%= config.bin %> init project                  # Project setup only (uses default profile)',
    '<%= config.bin %> init project MyProfile        # Project setup with specific profile',
    '<%= config.bin %> init --agent                  # Agent mode (non-interactive)',
    '<%= config.bin %> init --json --profile=X --workspace=123 --branch=v1  # JSON output',
  ]
static flags = {
    ...BaseCommand.baseFlags,
    // Override agent to not be hidden (it's a documented feature for init)
    agent: Flags.boolean({
      default: false,
      description: 'Agent mode: output structured data instead of interactive prompts',
    }),
    branch: Flags.string({
      char: 'b',
      description: 'Branch to use',
      env: 'XANO_BRANCH',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force reinitialize',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON (takes precedence over --agent)',
    }),
    // Override profile with different description
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use or create',
      env: 'XANO_PROFILE',
    }),
    token: Flags.string({
      description: 'Access token (for creating new profile in agent mode)',
    }),
    workspace: Flags.string({
      char: 'w',
      description: 'Workspace ID to use',
    }),
  }
// Track output mode
  private jsonMode = false

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init)

    // --json takes precedence over --agent
    this.jsonMode = flags.json

    // Handle subcommands
    if (args.subcommand === 'profile') {
      await this.runProfileSetup(flags)
      return
    }

    if (args.subcommand === 'project') {
      await this.runProjectSetup(flags, args.profileArg)
      return
    }

    // Full flow: profile + project
    await this.runFullSetup(flags)
  }

  // ========== AGENT OUTPUT HELPERS ==========

  private agentComplete(result: Record<string, string>, nextCommand?: string): void {
    if (this.jsonMode) {
      this.log(JSON.stringify({
        complete: true,
        nextCommand,
        result,
      }, null, 2))
      return
    }

    console.log('AGENT_COMPLETE: true')
    console.log('AGENT_RESULT:')
    for (const [key, value] of Object.entries(result)) {
      console.log(`${key}=${value}`)
    }

    if (nextCommand) {
      console.log(`AGENT_NEXT: ${nextCommand}`)
    }
  }

  private agentInput(step: string, prompt: string, inputType: 'secret' | 'text', nextCommandTemplate: string): void {
    if (this.jsonMode) {
      this.log(JSON.stringify({
        inputRequired: {
          nextCommand: nextCommandTemplate,
          prompt,
          step,
          type: inputType,
        },
      }, null, 2))
      return
    }

    console.log(`AGENT_STEP: ${step}`)
    console.log(`AGENT_PROMPT: ${prompt}`)
    console.log(`AGENT_INPUT: ${inputType}`)
    console.log(`AGENT_NEXT: ${nextCommandTemplate}`)
  }

  private agentPrompt(
    step: string,
    prompt: string,
    options: Array<{ isDefault?: boolean; name: string; value: string; }>,
    nextCommandTemplate: string,
    map?: Record<string, number | string>
  ): void {
    if (this.jsonMode) {
      this.log(JSON.stringify({
        selectionRequired: {
          map,
          nextCommand: nextCommandTemplate,
          options: options.map(o => ({
            isDefault: o.isDefault || false,
            label: o.name,
            value: o.value,
          })),
          prompt,
          step,
        },
      }, null, 2))
      return
    }

    console.log(`AGENT_STEP: ${step}`)
    console.log(`AGENT_PROMPT: ${prompt}`)
    console.log('AGENT_OPTIONS:')
    for (const opt of options) {
      console.log(`- ${opt.name}${opt.isDefault ? ' [default]' : ''}`)
    }

    if (map && Object.keys(map).length > 0) {
      console.log('AGENT_MAP:')
      for (const [key, value] of Object.entries(map)) {
        console.log(`${key}=${value}`)
      }
    }

    console.log(`AGENT_NEXT: ${nextCommandTemplate}`)
  }

  // ========== PROFILE MANAGEMENT ==========

  private async createProfileAgentFlow(flags: { branch?: string; profile?: string; token?: string; workspace?: string; }): Promise<void> {
    if (!flags.token) {
      this.error('Token required for creating profile')
    }

    // Fetch instances
    const instances = await this.fetchInstances(flags.token, 'https://app.xano.com')

    if (instances.length === 0) {
      this.error('No instances found. Check your access token.')
    }

    // For now, use first instance (could add instance selection later)
    const instance = instances[0]

    // Need profile name - use instance name as default
    const profileName = instance.display || 'default'

    // Fetch workspaces
    const instanceOrigin = new URL(instance.meta_api).origin
    const workspaces = await this.fetchWorkspaces(flags.token, instanceOrigin)

    // If workspace not specified, prompt for it
    if (!flags.workspace && workspaces.length > 0) {
      const options = workspaces.map(w => ({
        name: w.name,
        value: w.id.toString(),
      }))
      const map: Record<string, number> = {}
      for (const w of workspaces) { map[w.name] = w.id }

      this.agentPrompt(
        'workspace',
        'Select default workspace for profile',
        options,
        `xano init profile --agent --profile=${CREATE_NEW_PROFILE} --token=<token> --workspace=<mapped_id>`,
        map
      )
      return
    }

    const workspaceId = flags.workspace ? Number.parseInt(flags.workspace, 10) : undefined
    const workspace = workspaces.find(w => w.id === workspaceId)

    // If branch not specified and we have workspace, get branches
    if (!flags.branch && workspaceId) {
      const branches = await this.fetchBranches(flags.token, instanceOrigin, workspaceId.toString())
      const nonBackup = branches.filter(b => !b.backup)

      if (nonBackup.length > 0) {
        const options = nonBackup.map(b => ({
          isDefault: b.live,
          name: b.live ? `${b.label} (live)` : b.label,
          value: b.label,
        }))

        this.agentPrompt(
          'branch',
          'Select default branch for profile',
          options,
          `xano init profile --agent --profile=${CREATE_NEW_PROFILE} --token=<token> --workspace=${workspaceId} --branch=<selection>`
        )
        return
      }
    }

    // Save profile
    await this.saveProfile({
      access_token: flags.token, // eslint-disable-line camelcase
      account_origin: 'https://app.xano.com', // eslint-disable-line camelcase
      branch: flags.branch,
      instance_origin: instanceOrigin, // eslint-disable-line camelcase
      name: profileName,
      workspace: workspaceId?.toString(),
    }, true)

    this.agentComplete({
      branch: flags.branch || 'not set',
      instance: instanceOrigin,
      profile: profileName,
      workspace: workspace?.name || 'not set',
    }, 'xano init project')
  }

  private async createProfileInteractive(): Promise<void> {
    // Get access token
    const { accessToken } = await inquirer.prompt([
      {
        mask: '',
        message: 'Enter your Xano access token:',
        name: 'accessToken',
        type: 'password',
        validate: (input: string) => input.trim() !== '' || 'Token cannot be empty',
      },
    ])

    this.log('\nValidating token...')

    // Fetch instances
    const instances = await this.fetchInstances(accessToken, 'https://app.xano.com')

    if (instances.length === 0) {
      this.error('No instances found. Check your access token.')
    }

    // Select instance
    let selectedInstance: Instance
    if (instances.length === 1) {
      selectedInstance = instances[0]
      this.log(`Using instance: ${selectedInstance.display}`)
    } else {
      const { instance } = await inquirer.prompt<{ instance: Instance }>([
        {
          choices: instances.map(i => ({
            name: `${i.name} (${i.display})`,
            value: i,
          })),
          message: 'Select instance:',
          name: 'instance',
          type: 'list',
        },
      ])
      selectedInstance = instance
    }

    const instanceOrigin = new URL(selectedInstance.meta_api).origin

    // Get profile name
    const { profileName } = await inquirer.prompt([
      {
        default: selectedInstance.display || 'default',
        message: 'Profile name:',
        name: 'profileName',
        type: 'input',
        validate: (input: string) => input.trim() !== '' || 'Name cannot be empty',
      },
    ])

    // Fetch workspaces
    this.log('\nFetching workspaces...')
    const workspaces = await this.fetchWorkspaces(accessToken, instanceOrigin)

    let selectedWorkspace: undefined | Workspace
    if (workspaces.length > 0) {
      const { workspace } = await inquirer.prompt<{ workspace: null | Workspace }>([
        {
          choices: [
            { name: '(Skip - no default workspace)', value: null },
            ...workspaces.map(w => ({ name: w.name, value: w })),
          ],
          message: 'Select default workspace:',
          name: 'workspace',
          type: 'list',
        },
      ])
      selectedWorkspace = workspace || undefined
    }

    // Fetch branches if workspace selected
    let selectedBranch: string | undefined
    if (selectedWorkspace) {
      this.log('\nFetching branches...')
      const branches = await this.fetchBranches(accessToken, instanceOrigin, selectedWorkspace.id.toString())
      const nonBackup = branches.filter(b => !b.backup)

      if (nonBackup.length > 0) {
        const liveBranch = nonBackup.find(b => b.live)
        const { branch } = await inquirer.prompt<{ branch: string }>([
          {
            choices: [
              ...(liveBranch ? [{ name: `(Use live branch: ${liveBranch.label})`, value: '' }] : [{ name: '(Skip)', value: '' }]),
              ...nonBackup.map(b => ({
                name: b.live ? `${b.label} (live)` : b.label,
                value: b.label,
              })),
            ],
            message: 'Select default branch:',
            name: 'branch',
            type: 'list',
          },
        ])
        selectedBranch = branch || undefined
      }
    }

    // Save profile
    await this.saveProfile({
      access_token: accessToken, // eslint-disable-line camelcase
      account_origin: 'https://app.xano.com', // eslint-disable-line camelcase
      branch: selectedBranch,
      instance_origin: instanceOrigin, // eslint-disable-line camelcase
      name: profileName,
      workspace: selectedWorkspace?.id.toString(),
    }, true)

    this.log(`\nProfile "${profileName}" created successfully!`)
  }

  private async fetchBranches(accessToken: string, origin: string, workspaceId: string): Promise<Branch[]> {
    const response = await fetch(`${origin}/api:meta/workspace/${workspaceId}/branch`, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch branches: ${response.status}`)
    }

    const data = await response.json() as RawBranch[]
    return data.map(b => ({
      backup: b.backup ?? false,
      label: b.label,
      live: b.live,
    }))
  }

  // ========== PROJECT SETUP ==========

  private async fetchInstances(accessToken: string, origin: string): Promise<Instance[]> {
    const response = await fetch(`${origin}/api:meta/instance`, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid access token.')
      }

      throw new Error(`Failed to fetch instances: ${response.status}`)
    }

    const data = await response.json() as RawInstance[]
    return data.map(i => ({
      display: i.display,
      id: i.id || i.name,
      meta_api: i.meta_api, // eslint-disable-line camelcase
      name: i.name,
    }))
  }

  // ========== FULL SETUP ==========

  private async fetchWorkspaces(accessToken: string, origin: string): Promise<Workspace[]> {
    const response = await fetch(`${origin}/api:meta/workspace`, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch workspaces: ${response.status}`)
    }

    const data = await response.json() as RawWorkspace[]
    return data.map(w => ({
      id: w.id,
      name: w.name,
    }))
  }

  // ========== API HELPERS ==========

  private async runFullSetup(flags: { agent?: boolean; branch?: string; force?: boolean; profile?: string; token?: string; workspace?: string; }): Promise<void> {
    const profiles = listProfileNames()

    // Step 1: Ensure we have a profile
    if (profiles.length === 0 && !flags.profile && !flags.token) {
      if (flags.agent || this.jsonMode) {
        this.agentInput('token', 'No profiles found. Enter your Xano access token', 'secret', 'xano init --agent --token=<user_input>')
        return
      }

      this.log('No profiles found. Let\'s create one.\n')
      await this.createProfileInteractive()
    } else if (flags.profile === CREATE_NEW_PROFILE || flags.token) {
      // Creating new profile
      if (flags.agent || this.jsonMode) {
        await this.createProfileAgentFlow(flags)
        return
      }

      await this.createProfileInteractive()
    }

    // Step 2: Select profile if multiple exist and none specified
    let profileName = flags.profile

    if (!profileName || profileName === CREATE_NEW_PROFILE) {
      const updatedProfiles = listProfileNames()
      const defaultProfile = getDefaultProfileName()

      if (updatedProfiles.length === 0) {
        this.error('No profiles available.')
      }

      if (updatedProfiles.length === 1) {
        profileName = updatedProfiles[0]
      } else if (flags.agent || this.jsonMode) {
        const options = [
          { name: CREATE_NEW_PROFILE, value: CREATE_NEW_PROFILE },
          ...updatedProfiles.map(p => ({
            isDefault: p === defaultProfile,
            name: p,
            value: p,
          })),
        ]
        this.agentPrompt(
          'profile',
          'Select profile',
          options,
          'xano init --agent --profile=<selection>'
        )
        return
      } else {
        const { selection } = await inquirer.prompt<{ selection: string }>([
          {
            choices: [
              { name: '+ Create new profile', value: CREATE_NEW_PROFILE },
              ...updatedProfiles.map(p => ({
                name: p === defaultProfile ? `${p} (default)` : p,
                value: p,
              })),
            ],
            default: defaultProfile,
            message: 'Select profile:',
            name: 'selection',
            type: 'list',
          },
        ])

        if (selection === CREATE_NEW_PROFILE) {
          await this.createProfileInteractive()
          profileName = getDefaultProfileName() || undefined
        } else {
          profileName = selection
        }
      }
    }

    // Step 3: Run project setup with the profile
    if (!flags.agent && !this.jsonMode) {
      this.log(`\nUsing profile: ${profileName}`)
    }

    await this.runProjectSetup(
      { ...flags, profile: profileName }
    )
  }

  private async runProfileSetup(flags: { agent?: boolean; branch?: string; profile?: string; token?: string; workspace?: string; }): Promise<void> {
    const profiles = listProfileNames()
    const defaultProfile = getDefaultProfileName()

    // Agent mode: profile selection
    if (flags.agent || this.jsonMode) {
      // If profile flag is CREATE_NEW, we need token
      if (flags.profile === CREATE_NEW_PROFILE) {
        if (!flags.token) {
          this.agentInput('token', 'Enter your Xano access token', 'secret', 'xano init profile --agent --profile=[CREATE_NEW] --token=<user_input>')
          return
        }

        // We have token, need to validate and get instances
        await this.createProfileAgentFlow(flags)
        return
      }

      // If no profile specified, show selection
      if (!flags.profile) {
        const options = [
          { name: CREATE_NEW_PROFILE, value: CREATE_NEW_PROFILE },
          ...profiles.map(p => ({
            isDefault: p === defaultProfile,
            name: p,
            value: p,
          })),
        ]
        this.agentPrompt(
          'profile',
          'Select profile or create new',
          options,
          'xano init profile --agent --profile=<selection>'
        )
        return
      }

      // Profile selected, show success (no project config yet during init)
      const profile = getProfile(flags.profile)
      if (!profile) {
        this.error(`Profile "${flags.profile}" not found.`)
      }

      this.agentComplete({
        branch: profile.branch || 'not set',
        instance: profile.instance_origin,
        profile: flags.profile,
        workspace: profile.workspace?.toString() || 'not set',
      })
      return
    }

    // Interactive mode
    this.log('Profile Management\n')

    // Show selection: create new or select existing
    const choices = [
      { name: '+ Create new profile', value: CREATE_NEW_PROFILE },
      ...profiles.map(p => ({
        name: p === defaultProfile ? `${p} (default)` : p,
        value: p,
      })),
    ]

    const { selection } = await inquirer.prompt<{ selection: string }>([
      {
        choices,
        message: 'Select profile:',
        name: 'selection',
        type: 'list',
      },
    ])

    if (selection === CREATE_NEW_PROFILE) {
      await this.createProfileInteractive()
    } else {
      const profile = getProfile(selection)
      this.log(`\nProfile: ${selection}`)
      this.log(`  Instance: ${profile?.instance_origin}`)
      this.log(`  Workspace: ${profile?.workspace || 'not set'}`)
      this.log(`  Branch: ${profile?.branch || 'not set'}`)
    }
  }

  private async runProjectSetup(flags: { agent?: boolean; branch?: string; force?: boolean; profile?: string; workspace?: string; }, profileArg?: string): Promise<void> {
    const projectRoot = findProjectRoot() || process.cwd()
    const hasConfigJson = existsSync(getConfigJsonPath(projectRoot))
    const hasXanoJson = existsSync(getXanoJsonPath(projectRoot))

    // Check if already initialized
    if (hasConfigJson && !flags.force) {
      const config = loadLocalConfig(projectRoot)
      if (flags.agent || this.jsonMode) {
        this.agentComplete({
          branch: config?.branch || '',
          status: 'already_initialized',
          workspace: config?.workspaceName || '',
        }, 'xano pull')
      } else {
        this.log('Project already initialized.')
        this.log(`  Workspace: ${config?.workspaceName}`)
        this.log(`  Branch: ${config?.branch}`)
        this.log('\nUse --force to reinitialize.')
      }

      return
    }

    // Get profile
    const profileName = flags.profile || profileArg || getDefaultProfileName()
    if (!profileName) {
      if (flags.agent || this.jsonMode) {
        this.agentPrompt(
          'profile',
          'No profile found. Create one first.',
          [{ name: CREATE_NEW_PROFILE, value: CREATE_NEW_PROFILE }],
          'xano init profile --agent'
        )
      } else {
        this.error('No profile found. Run "xano init profile" first.')
      }

      return
    }

    const profile = getProfile(profileName)
    if (!profile) {
      this.error(`Profile "${profileName}" not found.`)
    }

    // Use xano.json template if exists
    const projectConfig = hasXanoJson ? loadXanoJson(projectRoot) : null

    // Determine workspace
    let workspaceId: number
    let workspaceName: string

    if (flags.workspace) {
      workspaceId = Number.parseInt(flags.workspace, 10)
      workspaceName = `Workspace ${workspaceId}`
    } else if (projectConfig) {
      workspaceId = projectConfig.workspaceId
      workspaceName = projectConfig.workspace || `Workspace ${projectConfig.workspaceId}`
    } else if (profile.workspace) {
      // Handle backward compatibility: workspace can be number (ID) or string (name)
      const workspaces = await this.fetchWorkspaces(profile.access_token, profile.instance_origin)

      if (typeof profile.workspace === 'number') {
        workspaceId = profile.workspace
        const ws = workspaces.find(w => w.id === workspaceId)
        workspaceName = ws?.name || `Workspace ${workspaceId}`
      } else {
        // Old format: workspace is a string name, look up ID
        const ws = workspaces.find(w => w.name === profile.workspace)
        if (ws) {
          workspaceId = ws.id
          workspaceName = ws.name
        } else {
          // Workspace not found, fall through to selection
          if (flags.agent || this.jsonMode) {
            const options = workspaces.map(w => ({ name: w.name, value: w.id.toString() }))
            const map: Record<string, number> = {}
            for (const w of workspaces) { map[w.name] = w.id }

            this.agentPrompt(
              'workspace',
              `Workspace "${profile.workspace}" not found. Select workspace`,
              options,
              `xano init project --agent --profile=${profileName} --workspace=<mapped_id>`,
              map
            )
            return
          }

          this.warn(`Workspace "${profile.workspace}" from profile not found.`)
          const { workspace } = await inquirer.prompt<{ workspace: Workspace }>([
            {
              choices: workspaces.map(w => ({ name: w.name, value: w })),
              message: 'Select workspace:',
              name: 'workspace',
              type: 'list',
            },
          ])
          workspaceId = workspace.id
          workspaceName = workspace.name
        }
      }
    } else {
      // Need to select workspace
      const workspaces = await this.fetchWorkspaces(profile.access_token, profile.instance_origin)

      if (flags.agent || this.jsonMode) {
        const options = workspaces.map(w => ({ name: w.name, value: w.id.toString() }))
        const map: Record<string, number> = {}
        for (const w of workspaces) { map[w.name] = w.id }

        this.agentPrompt(
          'workspace',
          'Select workspace',
          options,
          `xano init project --agent --profile=${profileName} --workspace=<mapped_id>`,
          map
        )
        return
      }

      const { workspace } = await inquirer.prompt<{ workspace: Workspace }>([
        {
          choices: workspaces.map(w => ({ name: w.name, value: w })),
          message: 'Select workspace:',
          name: 'workspace',
          type: 'list',
        },
      ])
      workspaceId = workspace.id
      workspaceName = workspace.name
    }

    // Determine branch
    let branch: string

    if (flags.branch) {
      branch = flags.branch
    } else if (profile.branch) {
      branch = profile.branch
    } else {
      // Need to select branch
      const branches = await this.fetchBranches(profile.access_token, profile.instance_origin, workspaceId.toString())
      const nonBackup = branches.filter(b => !b.backup)

      if (flags.agent || this.jsonMode) {
        const options = nonBackup.map(b => ({
          isDefault: b.live,
          name: b.live ? `${b.label} (live)` : b.label,
          value: b.label,
        }))

        this.agentPrompt(
          'branch',
          'Select branch',
          options,
          `xano init project --agent --profile=${profileName} --workspace=${workspaceId} --branch=<selection>`
        )
        return
      }

      const liveBranch = nonBackup.find(b => b.live)
      const { selectedBranch } = await inquirer.prompt<{ selectedBranch: string }>([
        {
          choices: nonBackup.map(b => ({
            name: b.live ? `${b.label} (live)` : b.label,
            value: b.label,
          })),
          default: liveBranch?.label || nonBackup[0]?.label,
          message: 'Select branch:',
          name: 'selectedBranch',
          type: 'list',
        },
      ])
      branch = selectedBranch
    }

    // Create xano.json if not exists
    if (!hasXanoJson) {
      const instanceMatch = profile.instance_origin.match(/https?:\/\/([^./]+)/)
      const instance = instanceMatch ? instanceMatch[1] : profile.instance_origin

      const newProjectConfig: XanoProjectConfig = {
        instance,
        paths: getDefaultPaths(),
        profile: profileName,
        workspace: workspaceName,
        workspaceId,
      }
      saveXanoJson(projectRoot, newProjectConfig)
    }

    // Create .xano/config.json (VSCode compatible)
    const finalProjectConfig = loadXanoJson(projectRoot)!
    const localConfig = createLocalConfig(finalProjectConfig, branch)
    saveLocalConfig(projectRoot, localConfig)

    // Create .xano/cli.json (CLI-only settings that VSCode would overwrite)
    const cliConfig = createCliConfig(finalProjectConfig)
    if (Object.keys(cliConfig).length > 0) {
      saveCliConfig(projectRoot, cliConfig)
    }

    // Check if .xano/ is gitignored and warn if not
    const xanoGitignored = isXanoGitignored(projectRoot)

    if (flags.agent || this.jsonMode) {
      const result: Record<string, string> = {
        branch,
        filesCreated: hasXanoJson ? '.xano/config.json' : 'xano.json,.xano/config.json',
        profile: profileName,
        workspace: workspaceName,
        workspaceId: workspaceId.toString(),
      }

      if (!xanoGitignored) {
        result.warning = '.xano/ directory is not in .gitignore'
        result.action = 'Add ".xano/" to .gitignore to prevent committing local state'
      }

      this.agentComplete(result, 'xano pull')

      if (!this.jsonMode && !xanoGitignored) {
        console.log('AGENT_WARNING: .xano/ directory is not in .gitignore')
        console.log('AGENT_ACTION: Add ".xano/" to .gitignore to prevent committing local state')
      }
    } else {
      this.log(`\nProject initialized!`)
      this.log(`  Profile: ${profileName}`)
      this.log(`  Workspace: ${workspaceName}`)
      this.log(`  Branch: ${branch}`)

      if (!xanoGitignored) {
        this.log('')
        this.warn('The .xano/ directory is not in .gitignore.')
        this.log('  Add ".xano/" to .gitignore to prevent committing local state.')
      }

      this.log('')
      this.log("Run 'xano pull' to fetch files from Xano.")
    }
  }

  private async saveProfile(
    profile: { access_token: string; account_origin: string; branch?: string; instance_origin: string; name: string; workspace?: string },
    setAsDefault: boolean
  ): Promise<void> {
    const configDir = join(homedir(), '.xano')
    const credentialsPath = join(configDir, 'credentials.yaml')

    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    let credentials: CredentialsFile = { profiles: {} }

    if (existsSync(credentialsPath)) {
      try {
        const content = readFileSync(credentialsPath, 'utf8')
        const parsed = yaml.load(content) as CredentialsFile
        if (parsed?.profiles) {
          credentials = parsed
        }
      } catch {
        // Continue with empty credentials
      }
    }

    credentials.profiles[profile.name] = {
      access_token: profile.access_token, // eslint-disable-line camelcase
      account_origin: profile.account_origin, // eslint-disable-line camelcase
      instance_origin: profile.instance_origin, // eslint-disable-line camelcase
      ...(profile.workspace && { workspace: Number.parseInt(profile.workspace, 10) }),
      ...(profile.branch && { branch: profile.branch }),
    }

    if (setAsDefault) {
      credentials.default = profile.name
    }

    const yamlContent = yaml.dump(credentials, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    })

    writeFileSync(credentialsPath, yamlContent, 'utf8')
  }
}
