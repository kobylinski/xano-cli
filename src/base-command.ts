import {Command, Flags} from '@oclif/core'
import * as yaml from 'js-yaml'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface CredentialsFile {
  default?: string
  profiles: {
    [key: string]: unknown
  }
}

export default abstract class BaseCommand extends Command {
  static baseFlags = {
    agent: Flags.boolean({
      default: false,
      description: 'Agent mode (non-interactive, machine-readable output)',
      hidden: true,
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use for this command',
      env: 'XANO_PROFILE',
      required: false,
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
}
