import {Args, Flags} from '@oclif/core'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import BaseCommand from '../../../base-command.js'

interface ProfileConfig {
  account_origin?: string
  instance_origin: string
  access_token: string
  workspace?: string
  branch?: string
}

interface CredentialsFile {
  profiles: {
    [key: string]: ProfileConfig
  }
  default?: string
}

interface Function {
  id: number
  name: string
  description?: string
  type?: string
  created_at?: number | string
  updated_at?: number | string
  xanoscript?: any
  // Add other function properties as needed
}

export default class FunctionGet extends BaseCommand {
  static args = {
    function_id: Args.string({
      description: 'Function ID',
      required: true,
    }),
    workspace_id: Args.string({
      description: 'Workspace ID (or name if stored in profile)',
      required: false,
    }),
  }

  static override flags = {
    ...BaseCommand.baseFlags,
    output: Flags.string({
      char: 'o',
      description: 'Output format',
      required: false,
      default: 'summary',
      options: ['summary', 'json', 'xs'],
    }),
    include_draft: Flags.boolean({
      description: 'Include draft version',
      required: false,
      default: false,
    }),
    include_xanoscript: Flags.boolean({
      description: 'Include XanoScript in response',
      required: false,
      default: false,
    }),
  }

  static description = 'Get a specific function from a workspace'

  static examples = [
    `$ xscli function:get 145 40
Function: yo (ID: 145)
Created: 2025-10-10 10:30:00
Description: Sample function
`,
    `$ xscli function:get 145 --profile production
Function: yo (ID: 145)
Created: 2025-10-10 10:30:00
`,
    `$ xscli function:get 145 40 --output json
{
  "id": 145,
  "name": "yo",
  "description": "Sample function"
}
`,
    `$ xscli function:get 145 -p staging -o json --include_draft
{
  "id": 145,
  "name": "yo"
}
`,
    `$ xscli function:get 145 -p staging -o xs
function yo {
  input {
  }
  stack {
  }
  response = null
}
`,
  ]

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FunctionGet)

    // Get profile name (default or from flag/env)
    const profileName = flags.profile || this.getDefaultProfile()

    // Load credentials
    const credentials = this.loadCredentials()

    // Get the profile configuration
    if (!(profileName in credentials.profiles)) {
      this.error(
        `Profile '${profileName}' not found. Available profiles: ${Object.keys(credentials.profiles).join(', ')}\n` +
        `Create a profile using 'xscli profile:create'`,
      )
    }

    const profile = credentials.profiles[profileName]

    // Validate required fields
    if (!profile.instance_origin) {
      this.error(`Profile '${profileName}' is missing instance_origin`)
    }

    if (!profile.access_token) {
      this.error(`Profile '${profileName}' is missing access_token`)
    }

    // Determine workspace_id from argument or profile
    let workspaceId: string
    if (args.workspace_id) {
      workspaceId = args.workspace_id
    } else if (profile.workspace) {
      workspaceId = profile.workspace
    } else {
      this.error(
        `Workspace ID is required. Either:\n` +
        `  1. Provide it as an argument: xscli function:get ${args.function_id} <workspace_id>\n` +
        `  2. Set it in your profile using: xscli profile:edit ${profileName} -w <workspace_id>`,
      )
    }

    // Build query parameters
    // Automatically set include_xanoscript to true if output format is xs
    const includeXanoscript = flags.output === 'xs' ? true : flags.include_xanoscript

    const queryParams = new URLSearchParams({
      include_draft: flags.include_draft.toString(),
      include_xanoscript: includeXanoscript.toString(),
    })

    // Construct the API URL
    const apiUrl = `${profile.instance_origin}/api:meta/workspace/${workspaceId}/function/${args.function_id}?${queryParams.toString()}`

    // Fetch function from the API
    try {
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${profile.access_token}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        this.error(
          `API request failed with status ${response.status}: ${response.statusText}\n${errorText}`,
        )
      }

      const func = await response.json() as Function

      // Validate response is an object
      if (!func || typeof func !== 'object') {
        this.error('Unexpected API response format: expected a function object')
      }

      // Output results
      if (flags.output === 'json') {
        this.log(JSON.stringify(func, null, 2))
      } else if (flags.output === 'xs') {
        // xs (XanoScript) format - output only the xanoscript element
        if (func.xanoscript) {
          // If status is "ok", output only the value, otherwise output the full xanoscript object
          if (func.xanoscript.status === 'ok' && func.xanoscript.value !== undefined) {
            this.log(func.xanoscript.value)
          } else {
            this.log(JSON.stringify(func.xanoscript, null, 2))
          }
        } else {
          this.log('null')
        }
      } else {
        // summary format
        this.log(`Function: ${func.name} (ID: ${func.id})`)

        if (func.created_at) {
          this.log(`Created: ${func.created_at}`)
        }

        if (func.description) {
          this.log(`Description: ${func.description}`)
        }

        if (func.type) {
          this.log(`Type: ${func.type}`)
        }

        // Don't display xanoscript in summary mode as it can be very large
        if (func.xanoscript) {
          this.log(`XanoScript: (available with -o xs or -o json)`)
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Failed to fetch function: ${error.message}`)
      } else {
        this.error(`Failed to fetch function: ${String(error)}`)
      }
    }
  }

  private loadCredentials(): CredentialsFile {
    const configDir = path.join(os.homedir(), '.xano')
    const credentialsPath = path.join(configDir, 'credentials.yaml')

    // Check if credentials file exists
    if (!fs.existsSync(credentialsPath)) {
      this.error(
        `Credentials file not found at ${credentialsPath}\n` +
        `Create a profile using 'xscli profile:create'`,
      )
    }

    // Read credentials file
    try {
      const fileContent = fs.readFileSync(credentialsPath, 'utf8')
      const parsed = yaml.load(fileContent) as CredentialsFile

      if (!parsed || typeof parsed !== 'object' || !('profiles' in parsed)) {
        this.error('Credentials file has invalid format.')
      }

      return parsed
    } catch (error) {
      this.error(`Failed to parse credentials file: ${error}`)
    }
  }
}
