/**
 * xano init - Initialize Xano project and/or profile
 *
 * Based on docs/commands/init.draft.md (CANDIDATE spec)
 */

import { Args, Flags } from '@oclif/core'
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'

import type { FilePreview, Instance, Workspace } from '../../lib/init/engine.js'
import type { NamingMode, XanoProjectConfig } from '../../lib/types.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import { CredentialsManager, toTitleCase } from '../../lib/credentials.js'
import { browserLogin } from '../../lib/init/browser-login.js'
import { InitEngine } from '../../lib/init/engine.js'
import { AgentFrontend, InteractiveFrontend, SilentFrontend } from '../../lib/init/frontends.js'
import {
  ensureXanoDir,
  findProjectRoot,
  getConfigJsonPath,
  getDefaultPaths,
  getXanoJsonPath,
  isXanoGitignored,
  loadCliConfig,
  loadLocalConfig,
  loadXanoJson,
  saveCliConfig,
  saveDatasourcesConfig,
  saveLocalConfig,
  saveXanoJson,
} from '../../lib/project.js'

const CREATE_NEW_PROFILE = '[CREATE_NEW]'

export default class Init extends BaseCommand {
  // Args order matters for CLI parsing - subcommand must come first
  /* eslint-disable perfectionist/sort-objects */
  static args = {
    subcommand: Args.string({
      description: 'Subcommand: "profile", "project", or "login"',
      options: ['login', 'profile', 'project'],
      required: false,
    }),
    profileArg: Args.string({
      description: 'Profile name (for "project" subcommand)',
      required: false,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
static description = 'Initialize xano project and/or profile'
static examples = [
    '<%= config.bin %> init                          # Full setup (profile + project)',
    '<%= config.bin %> init login                    # Login via browser, save token',
    '<%= config.bin %> init login MyProfile          # Login and save to specific profile',
    '<%= config.bin %> init profile                  # Create/manage profiles only',
    '<%= config.bin %> init project                  # Project setup only (uses default profile)',
    '<%= config.bin %> init project MyProfile        # Project setup with specific profile',
    '<%= config.bin %> init --dry-run                # Preview changes without writing',
    '<%= config.bin %> init --no-interaction --profile=X --workspace=123  # Non-interactive',
  ]
static flags = {
    ...BaseCommand.baseFlags,
    'access-token': Flags.string({
      description: 'Access token (creates/updates profile)',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Agent mode: output structured markdown for AI agents',
    }),
    branch: Flags.string({
      char: 'b',
      description: 'Default branch',
      env: 'XANO_BRANCH',
    }),
    datasource: Flags.string({
      description: 'Default datasource (default: live)',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Preview changes without writing files',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force reinitialize / override conflicts',
    }),
    instance: Flags.string({
      description: 'Instance URL (e.g., https://db.example.com)',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output JSON (only with --no-interaction)',
    }),
    naming: Flags.string({
      description: 'Naming mode (default, vscode, vscode_id, vscode_name)',
      options: ['default', 'vscode', 'vscode_id', 'vscode_name'],
    }),
    'no-interaction': Flags.boolean({
      default: false,
      description: 'Non-interactive mode (fail on missing data)',
    }),
    'paths-apis': Flags.string({ description: 'APIs directory', hidden: true }),
    'paths-functions': Flags.string({ description: 'Functions directory', hidden: true }),
    'paths-tables': Flags.string({ description: 'Tables directory', hidden: true }),
    'paths-tasks': Flags.string({ description: 'Tasks directory', hidden: true }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use or create',
      env: 'XANO_PROFILE',
    }),
    workspace: Flags.string({
      char: 'w',
      description: 'Workspace ID or name',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init)

    // Validate mutually exclusive flags
    if (flags['no-interaction'] && flags.agent) {
      this.error('--no-interaction and --agent are mutually exclusive')
    }

    // Determine operating mode
    const agentMode = flags.agent || isAgentMode()
    const nonInteractive = flags['no-interaction']

    // Handle subcommands
    if (args.subcommand === 'login') {
      await this.runBrowserLogin(flags, args.profileArg)
      return
    }

    if (args.subcommand === 'profile') {
      await this.runProfileSetup(flags, agentMode, nonInteractive)
      return
    }

    if (args.subcommand === 'project') {
      await this.runProjectSetup(flags, args.profileArg, agentMode, nonInteractive)
      return
    }

    // Full flow: profile + project
    await this.runFullSetup(flags, agentMode, nonInteractive)
  }

  // ========== Browser Login ==========

  private buildFlagsString(flags: Record<string, unknown>): string {
    const parts: string[] = []
    if (flags.profile) parts.push(`--profile=${flags.profile}`)
    if (flags.workspace) parts.push(`--workspace=${flags.workspace}`)
    if (flags.branch) parts.push(`--branch=${flags.branch}`)
    if (flags.naming) parts.push(`--naming=${flags.naming}`)
    if (flags.datasource) parts.push(`--datasource=${flags.datasource}`)
    return parts.join(' ')
  }

  // ========== Full Setup Flow ==========

  private createFrontend(
    agentMode: boolean,
    nonInteractive: boolean,
    force: boolean,
    json: boolean,
    flags: Record<string, unknown>
  ) {
    if (agentMode) {
      return new AgentFrontend(() => this.buildFlagsString(flags))
    }

    if (nonInteractive) {
      return new SilentFrontend(
        {
          error: (msg: string) => this.error(msg),
          log: (msg: string) => this.log(msg),
          warn: (msg: string) => this.warn(msg),
        },
        force,
        json
      )
    }

    return new InteractiveFrontend({
      log: (msg: string) => this.log(msg),
      warn: (msg: string) => this.warn(msg),
    })
  }

  // ========== Profile Setup ==========

  private async createProfileFromToken(
    token: string,
    flags: Record<string, unknown>,
    credentials: CredentialsManager,
    agentMode: boolean
  ): Promise<void> {
    const engine = new InitEngine({
      frontend: new AgentFrontend(() => ''),
      projectRoot: process.cwd(),
    })

    const instances = await engine.fetchInstances(token, 'https://app.xano.com')

    if (instances.length === 0) {
      if (agentMode) {
        this.outputAgentError('NO_INSTANCES', 'No instances found. Check your access token.')
      } else {
        this.error('No instances found. Check your access token.')
      }

      return
    }

    const instance = instances[0]
    const profileFlag = flags.profile as string | undefined
    const profileName = profileFlag || toTitleCase(instance.display || 'Default')
    const instanceOrigin = new URL(instance.meta_api).origin

    const workspaceFlag = flags.workspace as string | undefined
    const branchFlag = flags.branch as string | undefined

    // If workspace not specified, prompt
    if (!workspaceFlag && agentMode) {
      const workspaces = await engine.fetchWorkspaces(token, instanceOrigin)
      if (workspaces.length > 0) {
        this.outputAgentSelectionRequired('workspace', 'Select default workspace for profile', workspaces.map(w => ({
          label: w.name,
          value: w.id.toString(),
        })), { 'access-token': token, profile: profileName })
        return
      }
    }

    const workspaceId = workspaceFlag ? Number.parseInt(workspaceFlag, 10) : undefined

    // If branch not specified and we have workspace, prompt
    if (!branchFlag && workspaceId && agentMode) {
      const branches = await engine.fetchBranches(token, instanceOrigin, workspaceId)
      const nonBackup = branches.filter(b => !b.backup)
      if (nonBackup.length > 0) {
        this.outputAgentSelectionRequired('branch', 'Select default branch for profile', nonBackup.map(b => ({
          isDefault: b.live,
          label: b.live ? `${b.label} (live)` : b.label,
          value: b.label,
        })), { 'access-token': token, profile: profileName, workspace: workspaceId })
        return
      }
    }

    // Save profile
    credentials.add({
      accessToken: token,
      accountOrigin: 'https://app.xano.com',
      branch: branchFlag,
      instanceOrigin,
      name: profileName,
      workspace: workspaceId,
    })
    credentials.setDefault(profileName)
    credentials.save()

    if (agentMode) {
      let output = `# Profile Created\n\n`
      output += `## Configuration\n\n`
      output += `| Setting | Value |\n`
      output += `|---------|-------|\n`
      output += `| Profile | ${profileName} |\n`
      output += `| Instance | ${instanceOrigin} |\n`
      output += `| Workspace | ${workspaceId || 'not set'} |\n`
      output += `| Branch | ${branchFlag || 'not set'} |\n`
      output += `\n## Next Step\n\n`
      output += '```bash\n'
      output += `xano init project --profile=${profileName}\n`
      output += '```\n'
      console.log(output)
    }
  }

  private async createProfileInteractive(credentials: CredentialsManager): Promise<void> {
    const inquirer = (await import('inquirer')).default

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

    const engine = new InitEngine({
      frontend: new InteractiveFrontend({ log: this.log.bind(this), warn: this.warn.bind(this) }),
      projectRoot: process.cwd(),
    })

    const instances = await engine.fetchInstances(accessToken, 'https://app.xano.com')

    if (instances.length === 0) {
      this.error('No instances found. Check your access token.')
    }

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
    const suggestedName = toTitleCase(selectedInstance.display || 'Default')

    const { profileName } = await inquirer.prompt([
      {
        default: suggestedName,
        message: 'Profile name:',
        name: 'profileName',
        type: 'input',
        validate: (input: string) => input.trim() !== '' || 'Name cannot be empty',
      },
    ])

    this.log('\nFetching workspaces...')
    const workspaces = await engine.fetchWorkspaces(accessToken, instanceOrigin)

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

    let selectedBranch: string | undefined
    if (selectedWorkspace) {
      this.log('\nFetching branches...')
      const branches = await engine.fetchBranches(accessToken, instanceOrigin, selectedWorkspace.id)
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

    credentials.add({
      accessToken,
      accountOrigin: 'https://app.xano.com',
      branch: selectedBranch,
      instanceOrigin,
      name: profileName,
      workspace: selectedWorkspace?.id,
    })
    credentials.setDefault(profileName)
    credentials.save()

    this.log(`\nProfile "${profileName}" created successfully!`)
  }

  // ========== Project Setup ==========

  private isGitRepository(dir: string): boolean {
    let current = dir
    while (current !== dirname(current)) {
      if (existsSync(`${current}/.git`)) {
        return true
      }

      current = dirname(current)
    }

    return false
  }

  // ========== Step Functions ==========

  private async organizeAccess(
    engine: InitEngine,
    flags: Record<string, unknown>,
    profileArg: string | undefined,
    agentMode: boolean,
    nonInteractive: boolean
  ): Promise<boolean> {
    const credentials = CredentialsManager.load()
    const profileFlag = flags.profile as string | undefined
    const profileName = profileFlag || profileArg || credentials.getDefault()

    if (!profileName) {
      const profiles = credentials.listNames()

      if (agentMode) {
        if (profiles.length === 0) {
          this.outputAgentLoginRequired()
        } else {
          this.outputAgentProfileSelection(profiles, credentials.getDefault())
        }

        return false
      }

      if (nonInteractive) {
        this.error('No profile found. Run "xano init login" first or specify --profile.')
      }

      // Interactive mode: prompt for auth method or profile selection
      if (profiles.length === 0) {
        // No profiles - prompt for authentication method
        const result = await this.promptAuthMethod()
        if (!result) {
          return false // User cancelled or error occurred
        }

        // result contains the profile that was created
        engine.setValue('profile', result.profileName, 'prompt')
        engine.setValue('accessToken', result.accessToken, 'prompt')
        engine.setValue('instanceOrigin', result.instanceOrigin, 'prompt')
        return true
      }

      // Has profiles - let user select or create new
      const selectedProfile = await this.promptSelectOrCreateProfile(credentials)
      if (!selectedProfile) {
        return false
      }

      if (selectedProfile.isNew) {
        engine.setValue('profile', selectedProfile.profileName, 'prompt')
        engine.setValue('accessToken', selectedProfile.accessToken, 'prompt')
        engine.setValue('instanceOrigin', selectedProfile.instanceOrigin, 'prompt')
      } else {
        const profile = credentials.get(selectedProfile.profileName)!
        engine.setValue('profile', selectedProfile.profileName, 'prompt')
        engine.setValue('accessToken', profile.accessToken, 'credentials.yaml')
        engine.setValue('instanceOrigin', profile.instanceOrigin, 'credentials.yaml')
      }

      return true
    }

    const profile = credentials.get(profileName)
    if (!profile) {
      const existingProfiles = credentials.listNames()

      if (agentMode) {
        this.outputAgentProfileNotFound(profileName, existingProfiles)
        return false
      }

      this.error(`Profile "${profileName}" not found.`)
    }

    engine.setValue('profile', profileName, 'flag')
    engine.setValue('accessToken', profile.accessToken, 'credentials.yaml')
    engine.setValue('instanceOrigin', profile.instanceOrigin, 'credentials.yaml')

    return true
  }

  private outputAgentError(code: string, message: string, suggestions?: string[]): void {
    let output = `# Error: ${code}\n\n`
    output += `${message}\n\n`
    if (suggestions && suggestions.length > 0) {
      output += `## Suggestions\n\n`
      for (const s of suggestions) {
        output += `- ${s}\n`
      }
    }

    console.log(output)
  }

  private outputAgentInputRequired(field: string, description: string, required: boolean): void {
    let output = `# Input Required\n\n`
    output += `## Missing: ${field}\n\n`
    output += `${description}\n\n`
    output += required ? '**This field is required.**\n\n' : ''
    output += `## Next Step\n\n`
    output += `After user provides input, run:\n\n`
    output += '```bash\n'
    output += `xano init --${field === 'accessToken' ? 'access-token' : field}=<value>\n`
    output += '```\n'
    console.log(output)
  }

  private outputAgentLoginRequired(): void {
    let output = `# Authentication Required\n\n`
    output += `No profiles found. User needs to authenticate with Xano.\n\n`
    output += `## Next Step\n\n`
    output += `Run browser login to acquire access token:\n\n`
    output += '```bash\n'
    output += `xano init login\n`
    output += '```\n\n'
    output += `The command will output the access token (last line) after successful login.\n`
    output += `Then continue with:\n\n`
    output += '```bash\n'
    output += `xano init --access-token=<token>\n`
    output += '```\n'
    console.log(output)
  }

  private outputAgentProfileComplete(profileName: string, profile: { branch?: string; instanceOrigin: string; workspace?: number; }): void {
    let output = `# Profile Selected\n\n`
    output += `## Configuration\n\n`
    output += `| Setting | Value |\n`
    output += `|---------|-------|\n`
    output += `| Profile | ${profileName} |\n`
    output += `| Instance | ${profile.instanceOrigin} |\n`
    output += `| Workspace | ${profile.workspace || 'not set'} |\n`
    output += `| Branch | ${profile.branch || 'not set'} |\n`
    output += `\n## Next Step\n\n`
    output += '```bash\n'
    output += `xano init project --profile=${profileName}\n`
    output += '```\n'
    console.log(output)
  }

  private outputAgentProfileNotFound(requestedName: string, existingProfiles: string[]): void {
    let output = `# Profile Not Found\n\n`
    output += `Profile "${requestedName}" does not exist.\n\n`

    if (existingProfiles.length > 0) {
      output += `## Available Profiles\n\n`
      for (const p of existingProfiles) {
        output += `- ${p}\n`
      }

      output += `\n## Is this a typo?\n\n`
      output += `If you meant to use an existing profile, run:\n\n`
      output += '```bash\n'
      output += `xano init --profile=<profile_name>\n`
      output += '```\n\n'
    }

    output += `## Create New Profile "${requestedName}"?\n\n`
    output += `To create a new profile, first acquire an access token:\n\n`
    output += '```bash\n'
    output += `xano init login\n`
    output += '```\n\n'
    output += `Then create the profile:\n\n`
    output += '```bash\n'
    output += `xano init --profile=${requestedName} --access-token=<token>\n`
    output += '```\n'
    console.log(output)
  }

  private outputAgentProfileSelection(profiles: string[], defaultProfile: string | undefined): void {
    let output = `# Profile Selection Required\n\n`
    output += `## Available Profiles\n\n`
    output += `| Profile | Default |\n`
    output += `|---------|---------|`
    for (const p of profiles) {
      output += `\n| ${p} | ${p === defaultProfile ? '✓' : ''} |`
    }

    output += '\n\n'
    output += `## Use Existing Profile\n\n`
    output += `To use an existing profile, run:\n\n`
    output += '```bash\n'
    output += `xano init --profile=<profile_name>\n`
    output += '```\n\n'
    output += `## Create New Profile\n\n`
    output += `To create a new profile, first acquire an access token:\n\n`
    output += '```bash\n'
    output += `xano init login\n`
    output += '```\n\n'
    output += `Then create the profile:\n\n`
    output += '```bash\n'
    output += `xano init --profile=<new_name> --access-token=<token>\n`
    output += '```\n'
    console.log(output)
  }

  private outputAgentSelectionRequired(
    field: string,
    description: string,
    options: Array<{ isDefault?: boolean; label: string; value: string; }>,
    previousFlags?: Record<string, unknown>
  ): void {
    let output = `# Selection Required\n\n`
    output += `## Step: ${field}\n\n`
    output += `${description}\n\n`
    output += `## Options\n\n`
    output += `| Label | Value | Default |\n`
    output += `|-------|-------|---------|`
    for (const opt of options) {
      output += `\n| ${opt.label} | ${opt.value} | ${opt.isDefault ? '✓' : ''} |`
    }

    output += '\n\n'
    output += `## Next Step\n\n`
    output += `After user selects, run:\n\n`
    output += '```bash\n'

    // Build command with previous flags
    let cmd = 'xano init'
    if (previousFlags) {
      if (previousFlags.profile) cmd += ` --profile=${previousFlags.profile}`
      if (previousFlags['access-token']) cmd += ` --access-token=${previousFlags['access-token']}`
      if (previousFlags.workspace) cmd += ` --workspace=${previousFlags.workspace}`
      if (previousFlags.branch) cmd += ` --branch=${previousFlags.branch}`
      if (previousFlags.naming) cmd += ` --naming=${previousFlags.naming}`
    }

    cmd += ` --${field}=<selected_value>`

    output += `${cmd}\n`
    output += '```\n'
    console.log(output)
  }

  private async promptAuthMethod(): Promise<null | {
    accessToken: string
    instanceOrigin: string
    profileName: string
  }> {
    const inquirer = (await import('inquirer')).default

    const { authMethod } = await inquirer.prompt<{ authMethod: 'browser' | 'token' }>([
      {
        choices: [
          { name: 'Login via browser (opens Xano login page)', value: 'browser' },
          { name: 'Enter access token manually', value: 'token' },
        ],
        message: 'How would you like to authenticate?',
        name: 'authMethod',
        type: 'list',
      },
    ])

    if (authMethod === 'browser') {
      this.log('Opening browser for Xano login...')
      this.log('Waiting for authentication (timeout: 5 minutes)...')

      try {
        const result = await browserLogin({
          apiUrl: 'https://app.xano.com',
          timeout: 300_000,
        })

        this.log('Login successful!')

        // Fetch instances to get instance origin
        const engine = new InitEngine({
          frontend: new AgentFrontend(() => ''),
          projectRoot: process.cwd(),
        })

        const instances = await engine.fetchInstances(result.accessToken, 'https://app.xano.com')

        if (instances.length === 0) {
          this.error('No instances found for this account.')
          return null
        }

        const instance = instances[0]
        const instanceOrigin = new URL(instance.meta_api).origin
        const suggestedName = toTitleCase(instance.display || 'Default')

        // Prompt for profile name with auto-generated default
        const { profileName } = await inquirer.prompt<{ profileName: string }>([
          {
            default: suggestedName,
            message: 'Profile name:',
            name: 'profileName',
            type: 'input',
            validate(input: string) {
              if (!input.trim()) {
                return 'Profile name is required'
              }

              return true
            },
          },
        ])

        // Save to credentials
        const credentials = CredentialsManager.load()
        credentials.add({
          accessToken: result.accessToken,
          accountOrigin: 'https://app.xano.com',
          instanceOrigin,
          name: profileName,
        })

        if (credentials.listNames().length === 1) {
          credentials.setDefault(profileName)
        }

        credentials.save()
        this.log(`Profile "${profileName}" created.`)

        return {
          accessToken: result.accessToken,
          instanceOrigin,
          profileName,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.error(`Login failed: ${message}`)
        return null
      }
    }

    // Manual token entry
    const { accessToken } = await inquirer.prompt<{ accessToken: string }>([
      {
        mask: '*',
        message: 'Enter your Xano access token:',
        name: 'accessToken',
        type: 'password',
        validate(input: string) {
          if (!input.trim()) {
            return 'Access token is required'
          }

          return true
        },
      },
    ])

    // Validate and fetch instances
    const engine = new InitEngine({
      frontend: new AgentFrontend(() => ''),
      projectRoot: process.cwd(),
    })

    try {
      const instances = await engine.fetchInstances(accessToken, 'https://app.xano.com')

      if (instances.length === 0) {
        this.error('No instances found. Check your access token.')
        return null
      }

      const instance = instances[0]
      const instanceOrigin = new URL(instance.meta_api).origin
      const profileName = toTitleCase(instance.display || 'Default')

      // Save to credentials
      const credentials = CredentialsManager.load()
      credentials.add({
        accessToken,
        accountOrigin: 'https://app.xano.com',
        instanceOrigin,
        name: profileName,
      })

      if (credentials.listNames().length === 1) {
        credentials.setDefault(profileName)
      }

      credentials.save()
      this.log(`Profile "${profileName}" created.`)

      return {
        accessToken,
        instanceOrigin,
        profileName,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Authentication failed: ${message}`)
      return null
    }
  }

  private async promptSelectOrCreateProfile(credentials: CredentialsManager): Promise<null | {
    accessToken: string
    instanceOrigin: string
    isNew: boolean
    profileName: string
  }> {
    const inquirer = (await import('inquirer')).default
    const profiles = credentials.listNames()
    const defaultProfile = credentials.getDefault()

    const choices = profiles.map(p => ({
      name: p === defaultProfile ? `${p} (default)` : p,
      value: p,
    }))

    choices.push({ name: '+ Create new profile', value: CREATE_NEW_PROFILE })

    const { selectedProfile } = await inquirer.prompt<{ selectedProfile: string }>([
      {
        choices,
        message: 'Select a profile:',
        name: 'selectedProfile',
        type: 'list',
      },
    ])

    if (selectedProfile === CREATE_NEW_PROFILE) {
      const result = await this.promptAuthMethod()
      if (!result) return null

      return {
        ...result,
        isNew: true,
      }
    }

    const profile = credentials.get(selectedProfile)!
    return {
      accessToken: profile.accessToken,
      instanceOrigin: profile.instanceOrigin,
      isNew: false,
      profileName: selectedProfile,
    }
  }

  private async resolveBranch(
    engine: InitEngine,
    flags: Record<string, unknown>,
    agentMode: boolean,
    nonInteractive: boolean
  ): Promise<boolean> {
    const branchFlag = flags.branch as string | undefined
    const workspaceId = engine.getValue<number>('workspace')!
    const accessToken = engine.getValue<string>('accessToken')!
    const instanceOrigin = engine.getValue<string>('instanceOrigin')!
    const credentials = CredentialsManager.load()
    const profile = credentials.get(engine.getValue<string>('profile')!)

    // Fetch branches first - needed for validation
    const branches = await engine.fetchBranches(accessToken, instanceOrigin, workspaceId)
    const nonBackup = branches.filter(b => !b.backup)

    if (branchFlag) {
      // Validate branch exists
      const found = nonBackup.find(b => b.label === branchFlag)
      if (!found) {
        if (agentMode) {
          this.outputAgentError(
            'BRANCH_NOT_FOUND',
            `Branch "${branchFlag}" not found.`,
            nonBackup.map(b => b.live ? `${b.label} (live)` : b.label)
          )
          return false
        }

        this.error(`Branch "${branchFlag}" not found.`)
      }

      engine.setValue('branch', branchFlag, 'flag')
      return true
    }

    // Resolve branch from profile or default
    const { branch: resolvedBranch, warning } = engine.resolveBranchLabel(branches, profile?.branch)

    // Get profile branch as potential default (only if it exists in available branches)
    const profileBranch = warning ? undefined : profile?.branch

    // Non-interactive mode: use profile branch or live branch directly
    if (nonInteractive) {
      if (profileBranch) {
        engine.setValue('branch', resolvedBranch, 'credentials.yaml')
        return true
      }

      if (nonBackup.length === 1) {
        engine.setValue('branch', nonBackup[0].label, 'default')
        return true
      }

      // Use live branch as default
      engine.setValue('branch', resolvedBranch, 'default')
      return true
    }

    // Agent mode: always prompt for selection (show profile/live as default)
    if (agentMode) {
      if (nonBackup.length === 1) {
        engine.setValue('branch', nonBackup[0].label, 'default')
        return true
      }

      this.outputAgentSelectionRequired('branch', 'Select branch', nonBackup.map(b => {
        const isCurrent = b.label === profileBranch
        const isLive = b.live
        let {label} = b
        if (isCurrent && isLive) {
          label = `${b.label} (current, live)`
        } else if (isCurrent) {
          label = `${b.label} (current)`
        } else if (isLive) {
          label = `${b.label} (live)`
        }

        return {
          isDefault: isCurrent || (!profileBranch && isLive),
          label,
          value: b.label,
        }
      }), { ...flags, workspace: workspaceId })
      return false
    }

    // Interactive mode: always prompt, use profile branch as default
    if (nonBackup.length === 1) {
      engine.setValue('branch', nonBackup[0].label, 'default')
      return true
    }

    // Interactive prompt with profile branch as default
    const selectedBranch = await this.selectBranchInteractive(nonBackup, profileBranch)
    engine.setValue('branch', selectedBranch, 'prompt')
    return true
  }

  // ========== Helper Methods ==========

  private async resolveConfiguration(
    engine: InitEngine,
    flags: Record<string, unknown>,
    projectRoot: string,
    agentMode: boolean,
    nonInteractive: boolean
  ): Promise<boolean> {
    const existingConfig = loadXanoJson(projectRoot)

    // Naming
    const namingFlag = flags.naming as NamingMode | undefined
    if (namingFlag) {
      engine.setValue('naming', namingFlag, 'flag')
    } else if (existingConfig?.naming) {
      engine.setValue('naming', existingConfig.naming, 'xano.json')
    } else if (agentMode) {
      // Agent mode: output selection required and stop
      const currentFlags = {
        ...flags,
        branch: engine.getValue<string>('branch'),
        workspace: engine.getValue<number>('workspace'),
      }
      this.outputAgentSelectionRequired('naming', 'Select naming scheme', [
        { isDefault: true, label: 'vscode (Recommended)', value: 'vscode' },
        { isDefault: false, label: 'default', value: 'default' },
        { isDefault: false, label: 'vscode_id', value: 'vscode_id' },
      ], currentFlags)
      return false
    } else if (nonInteractive) {
      engine.setValue('naming', 'default', 'default')
    } else {
      // Interactive mode: prompt for naming selection
      const naming = await this.selectNamingInteractive()
      engine.setValue('naming', naming, 'prompt')
    }

    // Datasource
    const datasourceFlag = flags.datasource as string | undefined
    if (datasourceFlag) {
      engine.setValue('datasource', datasourceFlag, 'flag')
    } else if (existingConfig?.defaultDatasource) {
      engine.setValue('datasource', existingConfig.defaultDatasource, 'xano.json')
    } else {
      engine.setValue('datasource', 'live', 'default')
    }

    // Datasources map
    if (existingConfig?.datasources) {
      engine.setValue('datasources', existingConfig.datasources, 'xano.json')
    }

    // Paths - use existing or defaults
    const paths = existingConfig?.paths || getDefaultPaths()
    engine.setValue('paths', paths, existingConfig?.paths ? 'xano.json' : 'default')

    return true
  }

  private async resolveInstance(
    engine: InitEngine,
    flags: Record<string, unknown>,
    agentMode: boolean
  ): Promise<boolean> {
    const instanceFlag = flags.instance as string | undefined
    const instanceOrigin = engine.getValue<string>('instanceOrigin')!
    const accessToken = engine.getValue<string>('accessToken')!

    // Parse instance from origin
    let instanceName: string
    let instanceUrl: string

    if (instanceFlag) {
      // User provided instance - parse it
      instanceUrl = instanceFlag.startsWith('http') ? instanceFlag : `https://${instanceFlag}`
      const match = instanceUrl.match(/https?:\/\/([^./]+)/)
      instanceName = match ? match[1] : instanceFlag
      engine.setValue('instance', instanceUrl, 'flag')
      engine.setValue('instanceName', instanceName, 'flag')
      engine.setValue('instanceOrigin', instanceUrl, 'flag')
    } else {
      // Use instance from profile
      const match = instanceOrigin.match(/https?:\/\/([^./]+)/)
      instanceName = match ? match[1] : instanceOrigin
      instanceUrl = instanceOrigin
      engine.setValue('instance', instanceUrl, 'credentials.yaml')
      engine.setValue('instanceName', instanceName, 'credentials.yaml')
    }

    // Fetch instance details to get canonical ID and display name
    try {
      const instances = await engine.fetchInstances(accessToken, 'https://app.xano.com')
      const found = instances.find(i =>
        i.name === instanceName ||
        i.id === instanceName ||
        i.meta_api.includes(instanceName)
      )

      if (found) {
        // Update instanceName to canonical ID (e.g., "x8yf-zrk9-qtux")
        engine.setValue('instanceName', found.name, 'api')
        engine.setValue('instanceDisplay', found.display, 'api')
      }
    } catch (error) {
      if (agentMode) {
        this.outputAgentError('API_ERROR', `Failed to fetch instances: ${error}`)
        return false
      }
      // Continue without display name
    }

    return true
  }

  private async resolveWorkspace(
    engine: InitEngine,
    flags: Record<string, unknown>,
    agentMode: boolean,
    nonInteractive: boolean
  ): Promise<boolean> {
    const workspaceFlag = flags.workspace as string | undefined
    const projectRoot = engine.getProjectRoot()
    const existingConfig = loadXanoJson(projectRoot)
    const accessToken = engine.getValue<string>('accessToken')!
    const instanceOrigin = engine.getValue<string>('instanceOrigin')!
    const credentials = CredentialsManager.load()
    const profile = credentials.get(engine.getValue<string>('profile')!)

    // Priority: flag > xano.json > profile > prompt
    if (workspaceFlag) {
      const workspaceId = Number.parseInt(workspaceFlag, 10)
      if (Number.isNaN(workspaceId)) {
        // It's a name, need to resolve via API
        const workspaces = await engine.fetchWorkspaces(accessToken, instanceOrigin)
        const found = engine.findWorkspaceByName(workspaces, workspaceFlag)
        if (!found) {
          if (agentMode) {
            this.outputAgentError('WORKSPACE_NOT_FOUND', `Workspace "${workspaceFlag}" not found.`, workspaces.map(w => w.name))
            return false
          }

          this.error(`Workspace "${workspaceFlag}" not found.`)
        }

        engine.setValue('workspace', found.id, 'flag')
        engine.setValue('workspaceName', found.name, 'api')
      } else {
        // Validate workspace ID exists
        const workspaces = await engine.fetchWorkspaces(accessToken, instanceOrigin)
        const found = workspaces.find(w => w.id === workspaceId)
        if (!found) {
          if (agentMode) {
            this.outputAgentError(
              'WORKSPACE_NOT_FOUND',
              `Workspace with ID ${workspaceId} not found.`,
              workspaces.map(w => `${w.name} (${w.id})`)
            )
            return false
          }

          this.error(`Workspace with ID ${workspaceId} not found.`)
        }

        engine.setValue('workspace', workspaceId, 'flag')
        engine.setValue('workspaceName', found.name, 'api')
      }

      return true
    }

    // If xano.json has workspace, use it (project is already configured)
    if (existingConfig?.workspaceId) {
      engine.setValue('workspace', existingConfig.workspaceId, 'xano.json')
      engine.setValue('workspaceName', existingConfig.workspace || `Workspace ${existingConfig.workspaceId}`, 'xano.json')
      return true
    }

    // Get profile's workspace as potential default
    const profileWorkspaceId = profile?.workspace

    // Non-interactive with profile workspace: use it directly
    if (profileWorkspaceId && nonInteractive) {
      engine.setValue('workspace', profileWorkspaceId, 'credentials.yaml')
      try {
        const workspaces = await engine.fetchWorkspaces(accessToken, instanceOrigin)
        const found = workspaces.find(w => w.id === profileWorkspaceId)
        engine.setValue('workspaceName', found?.name || `Workspace ${profileWorkspaceId}`, 'api')
      } catch {
        engine.setValue('workspaceName', `Workspace ${profileWorkspaceId}`, 'default')
      }

      return true
    }

    // Fetch workspaces for prompt or agent output
    const workspaces = await engine.fetchWorkspaces(accessToken, instanceOrigin)

    if (workspaces.length === 0) {
      if (agentMode) {
        this.outputAgentError('NO_WORKSPACES', 'No workspaces found in this instance.')
        return false
      }

      this.error('No workspaces found in this instance.')
    }

    // Agent mode: always prompt for selection (show profile value as default)
    if (agentMode) {
      this.outputAgentSelectionRequired('workspace', 'Select workspace', workspaces.map(w => ({
        isDefault: w.id === profileWorkspaceId,
        label: w.id === profileWorkspaceId ? `${w.name} (current)` : w.name,
        value: w.id.toString(),
      })), flags)
      return false
    }

    if (nonInteractive) {
      this.error('Workspace not specified. Use --workspace flag.')
    }

    // Interactive prompt - use profile workspace as default if available
    const selectedWorkspace = await this.selectWorkspaceInteractive(workspaces, profileWorkspaceId)
    engine.setValue('workspace', selectedWorkspace.id, 'prompt')
    engine.setValue('workspaceName', selectedWorkspace.name, 'prompt')
    return true
  }

  // ========== Interactive Prompts ==========

  /**
   * Browser login - pure token acquisition
   *
   * Opens browser, user logs in, captures token, prints it.
   * No file writes - just outputs ACCESS_TOKEN=<token> for agent consumption.
   */
  private async runBrowserLogin(
    _flags: Record<string, unknown>,
    _profileArg?: string
  ): Promise<void> {
    this.log('Opening browser for Xano login...')
    this.log('Waiting for authentication (timeout: 5 minutes)...')

    try {
      const result = await browserLogin({
        apiUrl: 'https://app.xano.com',
        timeout: 300_000,
      })

      this.log('')
      this.log('Login successful!')
      this.log('')
      this.log(result.accessToken)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Login failed: ${message}`)
    }
  }

  private async runFullSetup(
    flags: Record<string, unknown>,
    agentMode: boolean,
    nonInteractive: boolean
  ): Promise<void> {
    const credentials = CredentialsManager.load()
    const profiles = credentials.listNames()
    const tokenFlag = flags['access-token'] as string | undefined

    // Step 1: Ensure we have a profile
    if (profiles.length === 0 && !flags.profile && !tokenFlag) {
      if (agentMode) {
        this.outputAgentLoginRequired()
        return
      }

      if (nonInteractive) {
        this.error('No profiles found. Run "xano init login" first or provide --access-token.')
      }

      // Interactive mode: prompt for auth method (browser or token)
      this.log('No profiles found. Let\'s authenticate.\n')
      const result = await this.promptAuthMethod()
      if (!result) {
        return // User cancelled or error
      }
    } else if (tokenFlag) {
      await this.createProfileFromToken(tokenFlag, flags, credentials, agentMode)
      if (agentMode) return // Agent mode outputs and expects re-run
    }

    // Step 2: Select profile if multiple exist and none specified
    let profileName = flags.profile as string | undefined

    if (!profileName || profileName === CREATE_NEW_PROFILE) {
      const updatedCredentials = CredentialsManager.load()
      const updatedProfiles = updatedCredentials.listNames()
      const defaultProfile = updatedCredentials.getDefault()

      if (updatedProfiles.length === 0) {
        this.error('No profiles available.')
      }

      if (updatedProfiles.length === 1) {
        profileName = updatedProfiles[0]
      } else if (agentMode) {
        this.outputAgentProfileSelection(updatedProfiles, defaultProfile)
        return
      } else if (nonInteractive) {
        this.error('Multiple profiles exist. Specify --profile.')
      } else {
        profileName = await this.selectProfileInteractive(updatedProfiles, defaultProfile)
        if (profileName === CREATE_NEW_PROFILE) {
          const result = await this.promptAuthMethod()
          if (!result) {
            return // User cancelled or error
          }

          profileName = result.profileName
        }
      }
    }

    // Step 3: Run project setup with the profile
    if (!agentMode && !nonInteractive) {
      this.log(`\nUsing profile: ${profileName}`)
    }

    await this.runProjectSetup(
      { ...flags, profile: profileName },
      undefined,
      agentMode,
      nonInteractive
    )
  }

  private async runProfileSetup(
    flags: Record<string, unknown>,
    agentMode: boolean,
    nonInteractive: boolean
  ): Promise<void> {
    const credentials = CredentialsManager.load()
    const profiles = credentials.listNames()
    const defaultProfile = credentials.getDefault()
    const tokenFlag = flags['access-token'] as string | undefined
    const profileFlag = flags.profile as string | undefined

    if (agentMode) {
      if (tokenFlag) {
        await this.createProfileFromToken(tokenFlag, flags, credentials, true)
        return
      }

      if (profileFlag && profileFlag !== CREATE_NEW_PROFILE) {
        const profile = credentials.get(profileFlag)
        if (profile) {
          this.outputAgentProfileComplete(profileFlag, profile)
          return
        }

        this.outputAgentError('PROFILE_NOT_FOUND', `Profile "${profileFlag}" not found.`)
        return
      }

      this.outputAgentProfileSelection(profiles, defaultProfile)
      return
    }

    if (nonInteractive) {
      if (tokenFlag) {
        this.error('Cannot create profile in non-interactive mode without --profile name')
      }

      if (!profileFlag) {
        if (profiles.length === 0) {
          this.error('No profiles found. Run "xano init profile" interactively first.')
        }

        this.log(`Available profiles: ${profiles.join(', ')}`)
        return
      }

      const profile = credentials.get(profileFlag)
      if (!profile) {
        this.error(`Profile "${profileFlag}" not found.`)
      }

      this.log(JSON.stringify({
        branch: profile.branch || null,
        instance: profile.instanceOrigin,
        profile: profileFlag,
        workspace: profile.workspace || null,
      }, null, 2))
      return
    }

    // Interactive mode
    await this.runProfileSetupInteractive(credentials, profiles, defaultProfile)
  }

  // ========== Profile Creation ==========

  private async runProfileSetupInteractive(
    credentials: CredentialsManager,
    profiles: string[],
    defaultProfile: string | undefined
  ): Promise<void> {
    const inquirer = (await import('inquirer')).default

    this.log('Profile Management\n')

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
      await this.promptAuthMethod()
    } else {
      const profile = credentials.get(selection)
      this.log(`\nProfile: ${selection}`)
      this.log(`  Instance: ${profile?.instanceOrigin}`)
      this.log(`  Workspace: ${profile?.workspace || 'not set'}`)
      this.log(`  Branch: ${profile?.branch || 'not set'}`)
    }
  }

  private async runProjectSetup(
    flags: Record<string, unknown>,
    profileArg: string | undefined,
    agentMode: boolean,
    nonInteractive: boolean
  ): Promise<void> {
    const projectRoot = findProjectRoot() || process.cwd()
    const dryRun = flags['dry-run'] as boolean
    const force = flags.force as boolean
    const json = flags.json as boolean

    // Create frontend based on mode
    const frontend = this.createFrontend(agentMode, nonInteractive, force, json, flags)

    // Create engine
    const engine = new InitEngine({
      dryRun,
      force,
      frontend,
      projectRoot,
    })

    // Check if already initialized
    const hasConfigJson = existsSync(getConfigJsonPath(projectRoot))
    if (hasConfigJson && !force && !dryRun) {
      // If --profile is specified, update cli.json with the new profile
      const profileFlag = flags.profile as string | undefined
      if (profileFlag) {
        const credentials = CredentialsManager.load()
        const profile = credentials.get(profileFlag)
        if (!profile) {
          this.error(`Profile "${profileFlag}" not found. Run "xano profile:list" to see available profiles.`)
        }

        // Update cli.json with the new profile
        saveCliConfig(projectRoot, { profile: profileFlag })

        // Load existing config for display
        const existingConfig = loadLocalConfig(projectRoot)

        this.log('')
        this.log(`Profile updated to: ${profileFlag}`)
        this.log(`  Workspace: ${existingConfig?.workspaceName} (${existingConfig?.workspaceId})`)
        this.log(`  Branch: ${existingConfig?.branch}`)
        this.log('')
        this.log("Run 'xano pull' to fetch files from Xano.")
        return
      }

      // No profile flag, show warning about reinitializing
      const existingConfig = loadLocalConfig(projectRoot)
      const existingCliConfig = loadCliConfig(projectRoot)
      this.log('')
      this.log('Project already initialized:')
      this.log(`  Profile: ${existingCliConfig?.profile || '(not set)'}`)
      this.log(`  Workspace: ${existingConfig?.workspaceName} (${existingConfig?.workspaceId})`)
      this.log(`  Branch: ${existingConfig?.branch}`)
      this.log('')
      this.warn('Use --force to reinitialize, or --profile=<name> to change profile.')
      return
    }

    // Step 1: Organize access (resolve profile and access token)
    if (!await this.organizeAccess(engine, flags, profileArg, agentMode, nonInteractive)) {
      return
    }

    // Step 2: Resolve instance
    if (!await this.resolveInstance(engine, flags, agentMode)) {
      return
    }

    // Step 3: Resolve workspace
    if (!await this.resolveWorkspace(engine, flags, agentMode, nonInteractive)) {
      return
    }

    // Step 4: Resolve branch
    if (!await this.resolveBranch(engine, flags, agentMode, nonInteractive)) {
      return
    }

    // Step 5: Resolve configuration (includes naming scheme selection)
    if (!await this.resolveConfiguration(engine, flags, projectRoot, agentMode, nonInteractive)) {
      return
    }

    // Step 6: Write files (or preview for dry-run)
    await this.writeFiles(engine, projectRoot)
  }

  // ========== Agent Output Helpers ==========

  private async selectBranchInteractive(branches: { label: string; live?: boolean }[], defaultBranch?: string): Promise<string> {
    const inquirer = (await import('inquirer')).default
    // Use provided default, or fall back to live branch
    const effectiveDefault = defaultBranch || branches.find(b => b.live)?.label
    const { branch } = await inquirer.prompt<{ branch: string }>([
      {
        choices: branches.map(b => {
          const isCurrent = b.label === defaultBranch
          const isLive = b.live
          let name = b.label
          if (isCurrent && isLive) {
            name = `${b.label} (current, live)`
          } else if (isCurrent) {
            name = `${b.label} (current)`
          } else if (isLive) {
            name = `${b.label} (live)`
          }

          return { name, value: b.label }
        }),
        default: effectiveDefault,
        message: 'Select branch:',
        name: 'branch',
        type: 'list',
      },
    ])
    return branch
  }

  private async selectNamingInteractive(): Promise<NamingMode> {
    const inquirer = (await import('inquirer')).default
    const { naming } = await inquirer.prompt<{ naming: NamingMode }>([
      {
        choices: [
          {
            name: 'vscode - VSCode extension compatible (recommended)',
            value: 'vscode',
          },
          {
            name: 'default - CLI native naming',
            value: 'default',
          },
          {
            name: 'vscode_id - VSCode with ID prefix (123_function.xs)',
            value: 'vscode_id',
          },
        ],
        default: 'vscode',
        message: 'Select naming scheme:',
        name: 'naming',
        type: 'list',
      },
    ])
    return naming
  }

  private async selectProfileInteractive(profiles: string[], defaultProfile: string | undefined): Promise<string> {
    const inquirer = (await import('inquirer')).default
    const { selection } = await inquirer.prompt<{ selection: string }>([
      {
        choices: [
          { name: '+ Create new profile', value: CREATE_NEW_PROFILE },
          ...profiles.map(p => ({
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
    return selection
  }

  private async selectWorkspaceInteractive(workspaces: Workspace[], defaultWorkspaceId?: number): Promise<Workspace> {
    const inquirer = (await import('inquirer')).default
    const defaultWorkspace = defaultWorkspaceId ? workspaces.find(w => w.id === defaultWorkspaceId) : undefined
    const { workspace } = await inquirer.prompt<{ workspace: Workspace }>([
      {
        choices: workspaces.map(w => ({
          name: w.id === defaultWorkspaceId ? `${w.name} (current)` : w.name,
          value: w,
        })),
        default: defaultWorkspace,
        message: 'Select workspace:',
        name: 'workspace',
        type: 'list',
      },
    ])
    return workspace
  }

  private async writeFiles(
    engine: InitEngine,
    projectRoot: string
  ): Promise<void> {
    const config = engine.getConfig()
    const hasXanoJson = existsSync(getXanoJsonPath(projectRoot))
    const warnings: string[] = []
    const filesCreated: string[] = []
    const preview: FilePreview[] = []

    // Prepare xano.json content (versioned, shared - NO profile here)
    const xanoJsonContent: XanoProjectConfig = {
      branch: config.branch,
      instance: config.instance!,
      naming: config.naming,
      paths: config.paths!,
      workspaceId: config.workspace!,
      ...(config.datasources && { datasources: config.datasources }),
      ...(config.datasource && config.datasource !== 'live' && { defaultDatasource: config.datasource }),
    }

    // Prepare config.json content (VSCode compatible format)
    // Use profile name for instanceDisplay if available (user's chosen name),
    // otherwise fall back to API display name
    const configJsonContent = {
      branch: config.branch,
      instanceDisplay: config.profile || config.instanceDisplay,
      instanceName: config.instanceName,
      instanceOrigin: config.instanceOrigin,
      paths: config.paths,
      workspaceId: config.workspace,
      workspaceName: config.workspaceName,
    }

    // Prepare datasources.json content (if needed)
    const datasourcesContent = config.datasources ? {
      datasources: config.datasources,
      defaultDatasource: config.datasource || 'live',
    } : null

    // Check gitignore (only if git repo exists)
    if (this.isGitRepository(projectRoot) && !isXanoGitignored(projectRoot)) {
      warnings.push('.xano/ directory is not in .gitignore. Add it to prevent committing local state.')
    }

    // Prepare cli.json content (profile is REQUIRED and stored ONLY here)
    const cliJsonContent = {
      ...(config.naming && { naming: config.naming }),
      profile: config.profile,  // MANDATORY - single source of truth for profile
    }

    if (engine.isDryRun()) {
      // Dry run - build preview
      preview.push({
        action: hasXanoJson ? 'update' : 'create',
        content: xanoJsonContent as unknown as Record<string, unknown>,
        path: 'xano.json',
      }, {
        action: 'create',
        content: configJsonContent,
        path: '.xano/config.json',
      }, {
        action: 'create',
        content: cliJsonContent,
        path: '.xano/cli.json',
      })

      if (datasourcesContent) {
        preview.push({
          action: 'create',
          content: datasourcesContent,
          path: '.xano/datasources.json',
        })
      }

      engine.complete({
        filesCreated: [],
        preview,
        success: true,
        warnings,
      })
      return
    }

    // Actually write files
    if (!hasXanoJson || engine.isForce()) {
      saveXanoJson(projectRoot, xanoJsonContent)
      filesCreated.push('xano.json')
    }

    ensureXanoDir(projectRoot)
    saveLocalConfig(projectRoot, {
      branch: config.branch!,
      instanceDisplay: config.profile || config.instanceDisplay,
      instanceName: config.instanceName!,
      instanceOrigin: config.instanceOrigin,
      paths: config.paths!,
      workspaceId: config.workspace!,
      workspaceName: config.workspaceName!,
    })
    filesCreated.push('.xano/config.json')

    // Save cli.json - MANDATORY for CLI operations (contains profile)
    saveCliConfig(projectRoot, cliJsonContent)
    filesCreated.push('.xano/cli.json')

    if (datasourcesContent) {
      saveDatasourcesConfig(projectRoot, datasourcesContent)
      filesCreated.push('.xano/datasources.json')
    }

    // Update credentials.yaml with workspace and branch
    // This ensures the profile has complete information for future use
    if (config.profile && (config.workspace || config.branch)) {
      const credentials = CredentialsManager.load()
      const existingProfile = credentials.get(config.profile)
      if (existingProfile) {
        credentials.add({
          ...existingProfile,
          ...(config.workspace !== undefined && { workspace: config.workspace }),
          ...(config.branch && { branch: config.branch }),
        })
        credentials.save()
      }
    }

    engine.complete({
      filesCreated,
      success: true,
      warnings,
    })
  }
}
