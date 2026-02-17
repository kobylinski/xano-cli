/**
 * Init Frontends - UI adapters for different operating modes
 *
 * Based on docs/commands/init.draft.md (CANDIDATE spec)
 */

import inquirer from 'inquirer'

import type {
  CompleteEvent,
  ConflictEvent,
  InitConfig,
  InitFrontend,
  MissingDataEvent,
  ProgressEvent,
  ValidationErrorEvent,
} from './engine.js'

// ========== Interactive Frontend ==========

export class InteractiveFrontend implements InitFrontend {
  private logger: { log: (msg: string) => void; warn: (msg: string) => void }

  constructor(logger: { log: (msg: string) => void; warn: (msg: string) => void }) {
    this.logger = logger
  }

  onComplete(event: CompleteEvent): void {
    if (event.preview) {
      this.renderDryRunPreview(event)
      return
    }

    this.logger.log('')
    if (event.success) {
      this.logger.log('Project initialized!')
      this.logger.log(`  Profile: ${event.config.profile}`)
      this.logger.log(`  Workspace: ${event.config.workspaceName} (${event.config.workspace})`)
      this.logger.log(`  Branch: ${event.config.branch}`)

      if (event.filesCreated.length > 0) {
        this.logger.log('')
        this.logger.log('Files created:')
        for (const file of event.filesCreated) {
          this.logger.log(`  - ${file}`)
        }
      }

      if (event.warnings.length > 0) {
        this.logger.log('')
        for (const warning of event.warnings) {
          this.logger.warn(warning)
        }
      }

      this.logger.log('')
      this.logger.log("Run 'xano pull' to fetch files from Xano.")
    } else {
      this.logger.warn('Initialization failed.')
    }
  }

  async onConflict(event: ConflictEvent): Promise<'abort' | 'keep' | 'override'> {
    const { action } = await inquirer.prompt<{ action: 'abort' | 'keep' | 'override' }>([
      {
        choices: [
          { name: `Keep: ${JSON.stringify(event.sources[0].value)} (from ${event.sources[0].source})`, value: 'keep' },
          { name: `Override with: ${JSON.stringify(event.sources[1].value)} (from ${event.sources[1].source})`, value: 'override' },
          { name: 'Abort', value: 'abort' },
        ],
        message: `Conflict in ${event.field}: ${event.recommendation}`,
        name: 'action',
        type: 'list',
      },
    ])
    return action
  }

  async onMissingData(event: MissingDataEvent): Promise<string | undefined> {
    if (event.suggestions && event.suggestions.length > 0) {
      // Selection prompt
      const defaultIndex = event.suggestions.findIndex(s => s.isDefault)
      const { value } = await inquirer.prompt<{ value: string }>([
        {
          choices: event.suggestions.map(s => ({
            name: s.label,
            value: s.value,
          })),
          default: defaultIndex === -1 ? undefined : defaultIndex,
          message: event.description,
          name: 'value',
          type: 'list',
        },
      ])
      return value
    }

    // Text input prompt
    const { value } = await inquirer.prompt<{ value: string }>([
      {
        message: event.description,
        name: 'value',
        type: event.field === 'accessToken' ? 'password' : 'input',
        validate(input: string) {
          if (event.required && !input.trim()) {
            return `${event.field} is required`
          }

          return true
        },
      },
    ])
    return value || undefined
  }

  onProgress(event: ProgressEvent): void {
    const icon = event.status === 'running' ? '...' :
      event.status === 'complete' ? '✓' :
        event.status === 'error' ? '✗' : '○'

    this.logger.log(`${icon} ${event.step}${event.message ? `: ${event.message}` : ''}`)
  }

  async onValidationError(event: ValidationErrorEvent): Promise<string | undefined> {
    this.logger.warn(`Invalid ${event.field}: ${event.error}`)

    if (event.suggestions && event.suggestions.length > 0) {
      const { value } = await inquirer.prompt<{ value: string }>([
        {
          choices: event.suggestions.map(s => ({ name: s, value: s })),
          message: `Select a valid ${event.field}:`,
          name: 'value',
          type: 'list',
        },
      ])
      return value
    }

    const { value } = await inquirer.prompt<{ value: string }>([
      {
        message: `Enter a valid ${event.field}:`,
        name: 'value',
        type: 'input',
      },
    ])
    return value || undefined
  }

  private renderDryRunPreview(event: CompleteEvent): void {
    this.logger.log('')
    this.logger.log('═══════════════════════════════════════════════════════════════')
    this.logger.log('                    DRY RUN - No files written')
    this.logger.log('═══════════════════════════════════════════════════════════════')
    this.logger.log('')
    this.logger.log('Configuration:')
    this.logger.log(`  Profile: ${event.config.profile}`)
    this.logger.log(`  Instance: ${event.config.instance} (${event.config.instanceName})`)
    this.logger.log(`  Workspace: ${event.config.workspaceName} (${event.config.workspace})`)
    this.logger.log(`  Branch: ${event.config.branch}`)
    this.logger.log(`  Naming: ${event.config.naming || 'default'}`)
    this.logger.log('')

    if (event.preview && event.preview.length > 0) {
      this.logger.log('Files that would be created/updated:')
      this.logger.log('')

      for (const file of event.preview) {
        const actionLabel = file.action.toUpperCase()
        this.logger.log(`┌─ ${file.path} (${actionLabel})`)
        this.logger.log('│')
        const lines = JSON.stringify(file.content, null, 2).split('\n')
        for (const line of lines) {
          this.logger.log(`│ ${line}`)
        }

        this.logger.log('└─')
        this.logger.log('')
      }
    }

    if (event.warnings.length > 0) {
      this.logger.log('Warnings:')
      for (const warning of event.warnings) {
        this.logger.warn(`  - ${warning}`)
      }

      this.logger.log('')
    }

    this.logger.log('Run without --dry-run to apply these changes.')
  }
}

// ========== Silent Frontend (Non-Interactive) ==========

export class SilentFrontend implements InitFrontend {
  private force: boolean
  private json: boolean
  private logger: { error: (msg: string) => never; log: (msg: string) => void; warn: (msg: string) => void }

  constructor(
    logger: { error: (msg: string) => never; log: (msg: string) => void; warn: (msg: string) => void },
    force: boolean,
    json: boolean = false
  ) {
    this.logger = logger
    this.force = force
    this.json = json
  }

  onComplete(event: CompleteEvent): void {
    if (this.json) {
      this.outputJson(event)
      return
    }

    // Human-readable text output
    this.outputText(event)
  }

  async onConflict(event: ConflictEvent): Promise<'abort' | 'keep' | 'override'> {
    if (this.force) {
      return 'override'
    }

    this.logger.error(
      `Conflict in ${event.field}:\n` +
      event.sources.map(s => `  ${s.source}: ${JSON.stringify(s.value)}`).join('\n') +
      '\nUse --force to override.'
    )
    return 'abort' // Never reached due to error()
  }

  async onMissingData(event: MissingDataEvent): Promise<string | undefined> {
    if (event.required) {
      this.logger.error(`Missing required field: ${event.field}\n  ${event.description}`)
    }

    return undefined
  }

  onProgress(event: ProgressEvent): void {
    if (event.status === 'error') {
      this.logger.log(`Error: ${event.step}: ${event.message}`)
    }
  }

  async onValidationError(event: ValidationErrorEvent): Promise<string | undefined> {
    this.logger.error(`Invalid ${event.field}: ${event.error}`)
    return undefined // Never reached
  }

  private formatConfig(config: InitConfig): Record<string, unknown> {
    return {
      branch: config.branch,
      instance: config.instance,
      instanceName: config.instanceName,
      profile: config.profile,
      workspace: config.workspace,
      workspaceName: config.workspaceName,
    }
  }

  private outputJson(event: CompleteEvent): void {
    if (event.preview) {
      // Dry run - output JSON preview
      this.logger.log(JSON.stringify({
        config: this.formatConfig(event.config),
        preview: event.preview,
        status: 'dry_run_complete',
        warnings: event.warnings,
      }, null, 2))
      return
    }

    if (event.success) {
      this.logger.log(JSON.stringify({
        config: this.formatConfig(event.config),
        filesCreated: event.filesCreated,
        status: 'complete',
        warnings: event.warnings,
      }, null, 2))
    }
  }

  private outputText(event: CompleteEvent): void {
    if (event.preview) {
      this.logger.log('')
      this.logger.log('DRY RUN - No files written')
      this.logger.log('')
      this.logger.log(`Profile: ${event.config.profile}`)
      this.logger.log(`Workspace: ${event.config.workspaceName} (${event.config.workspace})`)
      this.logger.log(`Branch: ${event.config.branch}`)
      return
    }

    if (event.success) {
      this.logger.log('')
      this.logger.log('Project initialized!')
      this.logger.log(`  Profile: ${event.config.profile}`)
      this.logger.log(`  Workspace: ${event.config.workspaceName} (${event.config.workspace})`)
      this.logger.log(`  Branch: ${event.config.branch}`)

      if (event.filesCreated.length > 0) {
        this.logger.log('')
        this.logger.log('Files created:')
        for (const file of event.filesCreated) {
          this.logger.log(`  - ${file}`)
        }
      }

      if (event.warnings.length > 0) {
        this.logger.log('')
        for (const warning of event.warnings) {
          this.logger.warn(warning)
        }
      }

      this.logger.log('')
      this.logger.log("Run 'xano pull' to fetch files from Xano.")
    }
  }
}

// ========== Agent Frontend (Markdown Output) ==========

export class AgentFrontend implements InitFrontend {
  private buildFlags: () => string
  private config: InitConfig = { sources: {} }

  constructor(buildFlags: () => string) {
    this.buildFlags = buildFlags
  }

  onComplete(event: CompleteEvent): void {
    if (event.preview) {
      this.renderDryRunMarkdown(event)
      return
    }

    let output = `# Initialization Complete\n\n`
    output += `## Configuration\n\n`
    output += `| Setting | Value |\n`
    output += `|---------|-------|\n`
    output += `| Profile | ${event.config.profile} |\n`
    output += `| Instance | ${event.config.instance} |\n`
    output += `| Instance ID | ${event.config.instanceName} |\n`
    output += `| Workspace | ${event.config.workspaceName} (${event.config.workspace}) |\n`
    output += `| Branch | ${event.config.branch} |\n`
    output += `| Naming | ${event.config.naming || 'default'} |\n`

    if (event.filesCreated.length > 0) {
      output += `\n## Files Created\n\n`
      for (const file of event.filesCreated) {
        output += `- ${file}\n`
      }
    }

    if (event.warnings.length > 0) {
      output += `\n## Warnings\n\n`
      for (const warning of event.warnings) {
        output += `- ${warning}\n`
      }
    }

    output += `\n## Next Step\n\n`
    output += '```bash\n'
    output += 'xano pull\n'
    output += '```\n'

    console.log(output)
  }

  async onConflict(event: ConflictEvent): Promise<'abort' | 'keep' | 'override'> {
    let output = `# Conflict Detected\n\n`
    output += `## Field: ${event.field}\n\n`
    output += `| Source | Value |\n`
    output += `|--------|-------|\n`
    for (const s of event.sources) {
      output += `| ${s.source} | ${JSON.stringify(s.value)} |\n`
    }

    output += `\n## Recommendation\n\n`
    output += `${event.recommendation}\n\n`
    output += `## Resolution Options\n\n`
    output += `1. **Keep**: Use value from ${event.sources[0].source}\n`
    output += `2. **Override**: Use value from ${event.sources[1].source}\n`
    output += `3. **Manual**: User should manually edit the config files\n\n`
    output += `Ask the user which option to choose.\n`

    console.log(output)
    return 'abort' // Agent mode aborts, expects user decision
  }

  async onMissingData(event: MissingDataEvent): Promise<string | undefined> {
    let output = `# Input Required\n\n`
    output += `## Current State\n\n`
    output += this.formatConfigTable()
    output += `\n## Missing: ${event.field}\n\n`
    output += `${event.description}\n\n`
    output += event.required ? '**This field is required.**\n\n' : 'This field is optional.\n\n'

    if (event.suggestions && event.suggestions.length > 0) {
      output += `## Options\n\n`
      output += `| Label | Value | Default |\n`
      output += `|-------|-------|---------|`
      for (const s of event.suggestions) {
        output += `\n| ${s.label} | ${s.value} | ${s.isDefault ? '✓' : ''} |`
      }

      output += '\n\n'
    }

    output += `## Next Step\n\n`
    output += `After ${event.suggestions ? 'user selects' : 'user provides input'}, run:\n\n`
    output += '```bash\n'
    output += `xano init --${event.field}=<value> ${this.buildFlags()}\n`
    output += '```\n'

    console.log(output)
    return undefined // Agent mode returns undefined, expects re-run with new flags
  }

  onProgress(_event: ProgressEvent): void {
    // Agent mode: silent progress, only output at completion
  }

  async onValidationError(event: ValidationErrorEvent): Promise<string | undefined> {
    let output = `# Validation Error\n\n`
    output += `## Field: ${event.field}\n\n`
    output += `**Value:** ${JSON.stringify(event.value)}\n\n`
    output += `**Error:** ${event.error}\n\n`

    if (event.suggestions && event.suggestions.length > 0) {
      output += `## Suggestions\n\n`
      for (const s of event.suggestions) {
        output += `- ${s}\n`
      }

      output += '\n'
    }

    output += `## Next Step\n\n`
    output += `Ask the user to provide a valid value for ${event.field}.\n`

    console.log(output)
    return undefined
  }

  updateConfig(config: InitConfig): void {
    this.config = config
  }

  private formatConfigTable(): string {
    const entries = Object.entries(this.config)
      .filter(([k, v]) => k !== 'sources' && v !== undefined)

    if (entries.length === 0) {
      return '(no configuration set yet)\n'
    }

    let table = `| Setting | Value |\n`
    table += `|---------|-------|\n`
    for (const [key, value] of entries) {
      table += `| ${key} | ${JSON.stringify(value)} |\n`
    }

    return table
  }

  private renderDryRunMarkdown(event: CompleteEvent): void {
    let output = `# Dry Run Complete\n\n`
    output += `## Configuration Summary\n\n`
    output += `| Setting | Value |\n`
    output += `|---------|-------|\n`
    output += `| Profile | ${event.config.profile} |\n`
    output += `| Instance | ${event.config.instance} |\n`
    output += `| Instance ID | ${event.config.instanceName} |\n`
    output += `| Workspace | ${event.config.workspaceName} (${event.config.workspace}) |\n`
    output += `| Branch | ${event.config.branch} |\n`
    output += `| Naming | ${event.config.naming || 'default'} |\n`
    output += `| Datasource | ${event.config.datasource || 'live'} |\n`

    if (event.preview && event.preview.length > 0) {
      output += `\n## Files Preview\n`

      for (const file of event.preview) {
        output += `\n### ${file.path} (${file.action.toUpperCase()})\n\n`
        output += '```json\n'
        output += JSON.stringify(file.content, null, 2)
        output += '\n```\n'
      }
    }

    if (event.warnings.length > 0) {
      output += `\n## Warnings\n\n`
      for (const warning of event.warnings) {
        output += `- ${warning}\n`
      }
    }

    output += `\n## Next Step\n\n`
    output += `Run without \`--dry-run\` to apply changes:\n\n`
    output += '```bash\n'
    output += `xano init ${this.buildFlags()}\n`
    output += '```\n'

    console.log(output)
  }
}
