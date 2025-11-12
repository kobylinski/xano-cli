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
}

interface Function {
  id: number
  name: string
  description?: string
  type?: string
  created_at?: number
  updated_at?: number
  // Add other function properties as needed
}

interface FunctionListResponse {
  functions?: Function[]
  items?: Function[]
  // Handle both array and object responses
}

export default class FunctionList extends BaseCommand {
  static args = {
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
      options: ['summary', 'json'],
    }),
    include_draft: Flags.boolean({
      description: 'Include draft functions',
      required: false,
      default: false,
    }),
    include_xanoscript: Flags.boolean({
      description: 'Include XanoScript in response',
      required: false,
      default: false,
    }),
    page: Flags.integer({
      description: 'Page number for pagination',
      required: false,
      default: 1,
    }),
    per_page: Flags.integer({
      description: 'Number of results per page',
      required: false,
      default: 50,
    }),
    sort: Flags.string({
      description: 'Sort field',
      required: false,
      default: 'created_at',
    }),
    order: Flags.string({
      description: 'Sort order',
      required: false,
      default: 'desc',
      options: ['asc', 'desc'],
    }),
  }

  static description = 'List all functions in a workspace from the Xano Metadata API'

  static examples = [
    `$ xscli function:list 40
Available functions:
  - function-1 (ID: 1)
  - function-2 (ID: 2)
  - function-3 (ID: 3)
`,
    `$ xscli function:list --profile production
Available functions:
  - my-function (ID: 1)
  - another-function (ID: 2)
`,
    `$ xscli function:list 40 --output json
[
  {
    "id": 1,
    "name": "function-1"
  }
]
`,
    `$ xscli function:list -p staging -o json --include_draft
[
  {
    "id": 1,
    "name": "function-1"
  }
]
`,
  ]

  async run(): Promise<void> {
    const {args, flags} = await this.parse(FunctionList)

    // Get profile name (default or from flag/env)
    const profileName = flags.profile || 'default'

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
        `  1. Provide it as an argument: xscli function:list <workspace_id>\n` +
        `  2. Set it in your profile using: xscli profile:edit ${profileName} -w <workspace_id>`,
      )
    }

    // Build query parameters
    const queryParams = new URLSearchParams({
      include_draft: flags.include_draft.toString(),
      include_xanoscript: flags.include_xanoscript.toString(),
      page: flags.page.toString(),
      per_page: flags.per_page.toString(),
      sort: flags.sort,
      order: flags.order,
    })

    // Construct the API URL
    const apiUrl = `${profile.instance_origin}/api:meta/workspace/${workspaceId}/function?${queryParams.toString()}`

    // Fetch functions from the API
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

      const data = await response.json() as FunctionListResponse | Function[]

      // Handle different response formats
      let functions: Function[]

      if (Array.isArray(data)) {
        functions = data
      } else if (data && typeof data === 'object' && 'functions' in data && Array.isArray(data.functions)) {
        functions = data.functions
      } else if (data && typeof data === 'object' && 'items' in data && Array.isArray(data.items)) {
        functions = data.items
      } else {
        this.error('Unexpected API response format')
      }

      // Output results
      if (flags.output === 'json') {
        this.log(JSON.stringify(functions, null, 2))
      } else {
        // summary format
        if (functions.length === 0) {
          this.log('No functions found')
        } else {
          this.log('Available functions:')
          for (const func of functions) {
            if (func.id !== undefined) {
              this.log(`  - ${func.name} (ID: ${func.id})`)
            } else {
              this.log(`  - ${func.name}`)
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Failed to fetch functions: ${error.message}`)
      } else {
        this.error(`Failed to fetch functions: ${String(error)}`)
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
