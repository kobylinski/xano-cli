import {Command, Flags} from '@oclif/core'
import * as yaml from 'js-yaml'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { logger, resolveVerbosity } from './lib/logger.js'

interface CredentialsFile {
  default?: string
  profiles: {
    [key: string]: unknown
  }
}

/**
 * Detect if the CLI is being run by an AI agent based on environment variables.
 * Returns the name of the detected agent or null if not detected.
 *
 * Detected agents:
 * - XANO_AGENT_MODE=1 - Explicit agent mode (highest priority)
 * - CLAUDECODE=1 - Claude Code CLI/extension
 * - CURSOR_TRACE_ID - Cursor IDE with AI features
 * - VSCODE_GIT_ASKPASS_NODE + TERM_PROGRAM=vscode - VS Code with Copilot
 * - GITHUB_COPILOT_* - GitHub Copilot CLI
 * - AIDER_* - Aider AI coding assistant
 * - OPENCODE - OpenCode AI terminal agent
 */
export function detectAgentEnvironment(): null | string {
  // Explicit agent mode (highest priority)
  if (process.env.XANO_AGENT_MODE === '1' || process.env.XANO_AGENT_MODE === 'true') {
    return 'xano-agent'
  }

  // Claude Code (CLI or extension)
  if (process.env.CLAUDECODE === '1') {
    return 'claude-code'
  }

  // Cursor IDE
  if (process.env.CURSOR_TRACE_ID) {
    return 'cursor'
  }

  // GitHub Copilot CLI
  if (process.env.GITHUB_COPILOT_TOKEN || process.env.COPILOT_AGENT_ENABLED === '1') {
    return 'github-copilot'
  }

  // Aider AI coding assistant
  if (process.env.AIDER_MODEL || process.env.AIDER_CHAT_HISTORY_FILE) {
    return 'aider'
  }

  // OpenCode AI terminal agent
  if (process.env.OPENCODE === '1') {
    return 'opencode'
  }

  return null
}

/**
 * Check if agent mode is active (via flag, env var, or auto-detection)
 */
export function isAgentMode(flagValue?: boolean): boolean {
  // Explicit flag always wins
  if (flagValue === true) return true
  if (flagValue === false && process.env.XANO_AGENT_MODE !== '1') return false

  // Auto-detect from environment
  return detectAgentEnvironment() !== null
}

export default abstract class BaseCommand extends Command {
  static baseFlags = {
    agent: Flags.boolean({
      default: false,
      description: 'Agent mode (non-interactive, machine-readable output)',
      env: 'XANO_AGENT_MODE',
      hidden: true,
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use for this command',
      env: 'XANO_PROFILE',
      required: false,
    }),
    silent: Flags.boolean({
      char: 's',
      default: false,
      description: 'Silent mode (errors only)',
    }),
    verbose: Flags.integer({
      char: 'v',
      default: 0,
      description: 'Verbosity level: 1=verbose, 2=debug, 3=trace (or use -v, -vv, -vvv)',
      max: 3,
      min: 0,
    }),
  }
// Override the flags property to include baseFlags
  static flags = BaseCommand.baseFlags

  // Helper method to get the default profile from credentials file
  protected getDefaultProfile(): string {
    try {
      const configDir = join(homedir(), '.xano')
      const credentialsPath = join(configDir, 'credentials.yaml')

      if (!existsSync(credentialsPath)) {
        return 'default'
      }

      const fileContent = readFileSync(credentialsPath, 'utf8')
      const parsed = yaml.load(fileContent) as CredentialsFile

      if (parsed && typeof parsed === 'object' && 'default' in parsed && parsed.default) {
        return parsed.default
      }

      return 'default'
    } catch {
      return 'default'
    }
  }

  // Helper method to get the profile flag value
  protected getProfile(): string | undefined {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- oclif workaround to access flags before parsing
    return (this as any).flags?.profile
  }

  /**
   * Initialize logger with verbosity level before command runs
   */
  async init(): Promise<void> {
    await super.init()

    // Parse flags to get verbosity settings
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { flags } = await (this as any).parse(this.constructor as typeof Command)

    // Load config verbosity if available
    let configVerbose: number | undefined
    try {
      const configDir = join(process.cwd(), '.xano')
      const cliConfigPath = join(configDir, 'cli.json')
      if (existsSync(cliConfigPath)) {
        const content = readFileSync(cliConfigPath, 'utf8')
        const config = JSON.parse(content)
        configVerbose = config.verbose
      }
    } catch {
      // Ignore config errors
    }

    // Resolve and set verbosity
    const level = resolveVerbosity(flags.verbose, flags.silent, configVerbose)
    logger.setLevel(level)
  }
}
