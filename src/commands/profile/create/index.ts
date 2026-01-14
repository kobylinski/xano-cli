import { Args, Command, Flags } from '@oclif/core'
import * as yaml from 'js-yaml'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface ProfileConfig {
  access_token: string
  account_origin: string
  branch?: string
  instance_origin: string
  name: string
  workspace?: string
}

interface CredentialsFile {
  default?: string
  profiles: {
    [key: string]: Omit<ProfileConfig, 'name'>
  }
}

export default class ProfileCreate extends Command {
  static args = {
    name: Args.string({
      description: 'Profile name',
      required: true,
    }),
  }
static description = '[DEPRECATED] Create a profile - use "xano init" instead'
static examples = [
    '<%= config.bin %> init              # Recommended: interactive setup',
    '<%= config.bin %> init profile      # Recommended: profile management',
    '',
    '# Legacy usage (still works):',
    '<%= config.bin %> profile:create production -i https://instance.xano.com -t token123',
  ]
static override flags = {
    access_token: Flags.string({ // eslint-disable-line camelcase
      char: 't',
      description: 'Access token for the Xano Metadata API',
      required: true,
    }),
    account_origin: Flags.string({ // eslint-disable-line camelcase
      char: 'a',
      description: 'Account origin URL',
      required: false,
    }),
    branch: Flags.string({
      char: 'b',
      description: 'Default branch name',
      required: false,
    }),
    default: Flags.boolean({
      default: false,
      description: 'Set this profile as the default',
      required: false,
    }),
    instance_origin: Flags.string({ // eslint-disable-line camelcase
      char: 'i',
      description: 'Instance origin URL',
      required: true,
    }),
    workspace: Flags.string({
      char: 'w',
      description: 'Default workspace ID',
      required: false,
    }),
  }
static hidden = true

  async run(): Promise<void> {
    this.warn('profile:create is deprecated. Use "xano init" for interactive setup.')
    this.log('')

    const { args, flags } = await this.parse(ProfileCreate)

    const configDir = join(homedir(), '.xano')
    const credentialsPath = join(configDir, 'credentials.yaml')

    // Ensure the .xano directory exists
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true })
    }

    // Read existing credentials file or create new structure
    let credentials: CredentialsFile = { profiles: {} }

    if (existsSync(credentialsPath)) {
      try {
        const fileContent = readFileSync(credentialsPath, 'utf8')
        const parsed = yaml.load(fileContent) as CredentialsFile

        if (parsed && typeof parsed === 'object' && 'profiles' in parsed) {
          credentials = parsed
        }
      } catch {
        // Continue with empty credentials
      }
    }

    // Add or update the profile
    const profileExists = args.name in credentials.profiles

    credentials.profiles[args.name] = {
      access_token: flags.access_token, // eslint-disable-line camelcase
      account_origin: flags.account_origin ?? 'https://app.xano.com', // eslint-disable-line camelcase
      instance_origin: flags.instance_origin, // eslint-disable-line camelcase
      ...(flags.workspace && { workspace: flags.workspace }),
      ...(flags.branch && { branch: flags.branch }),
    }

    // Set default if flag is provided
    if (flags.default) {
      credentials.default = args.name
    }

    // Write the updated credentials
    const yamlContent = yaml.dump(credentials, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
    })

    writeFileSync(credentialsPath, yamlContent, 'utf8')

    if (profileExists) {
      this.log(`Profile '${args.name}' updated successfully.`)
    } else {
      this.log(`Profile '${args.name}' created successfully.`)
    }

    if (flags.default) {
      this.log(`Default profile set to '${args.name}'`)
    }
  }
}
