import {Flags} from '@oclif/core'
import * as yaml from 'js-yaml'
import {execSync} from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import BaseCommand from '../../../../base-command.js'

interface ProfileConfig {
  access_token: string
  account_origin?: string
  branch?: string
  instance_origin: string
  workspace?: string
}

interface CredentialsFile {
  default?: string
  profiles: {
    [key: string]: ProfileConfig
  }
}

interface EndpointInput {
  default: string
  name: string
  nullable: boolean
  required: boolean
  source: string
  type: string
}

interface Endpoint {
  input: EndpointInput[]
  url: string
  verb: string
}

interface MetadataApi {
  url: string
}

interface EphemeralServiceResult {
  boot_time: number
  endpoints?: Endpoint[]
  metadata_api?: MetadataApi
  pre_result: any
  pre_time: number
}

interface EphemeralServiceResponse {
  result: EphemeralServiceResult
  service: {
    id: number
    run: {
      id: number
    }
  }
}

export default class EphemeralRunService extends BaseCommand {
  static args = {}
static description = 'Run an ephemeral service'
static examples = [
    `$ xano ephemeral:run:service -f service.xs
Service created successfully!
...
`,
    `$ xano ephemeral:run:service -f service.xs --edit
# Opens service.xs in $EDITOR, then creates service with edited content
Service created successfully!
...
`,
    `$ cat service.xs | xano ephemeral:run:service --stdin
Service created successfully!
...
`,
    `$ xano ephemeral:run:service -f service.xs -o json
{
  "service": { "id": 1 },
  ...
}
`,
  ]
static override flags = {
    ...BaseCommand.baseFlags,
    edit: Flags.boolean({
      char: 'e',
      default: false,
      dependsOn: ['file'],
      description: 'Open file in editor before running service (requires --file)',
      required: false,
    }),
    file: Flags.string({
      char: 'f',
      description: 'Path or URL to file containing XanoScript code',
      exclusive: ['stdin'],
      required: false,
    }),
    output: Flags.string({
      char: 'o',
      default: 'summary',
      description: 'Output format',
      options: ['summary', 'json'],
      required: false,
    }),
    stdin: Flags.boolean({
      char: 's',
      default: false,
      description: 'Read XanoScript code from stdin',
      exclusive: ['file'],
      required: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(EphemeralRunService)

    // Get profile name (default or from flag/env)
    const profileName = flags.profile || this.getDefaultProfile()

    // Load credentials
    const credentials = this.loadCredentials()

    // Get the profile configuration
    if (!(profileName in credentials.profiles)) {
      this.error(
        `Profile '${profileName}' not found. Available profiles: ${Object.keys(credentials.profiles).join(', ')}\n` +
        `Create a profile using 'xano profile:create'`,
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

    // Read XanoScript content or use URL
    let xanoscript: string | undefined
    let xanoscriptUrl: string | undefined

    if (flags.file) {
      if (this.isUrl(flags.file)) {
        // Pass URL directly to API
        xanoscriptUrl = flags.file
      } else if (flags.edit) {
        // If edit flag is set, copy to temp file and open in editor
        const fileToRead = await this.editFile(flags.file)
        xanoscript = fs.readFileSync(fileToRead, 'utf8')
        // Clean up temp file
        try {
          fs.unlinkSync(fileToRead)
        } catch {
          // Ignore cleanup errors
        }
      } else {
        try {
          xanoscript = fs.readFileSync(flags.file, 'utf8')
        } catch (error) {
          this.error(`Failed to read file '${flags.file}': ${error}`)
        }
      }
    } else if (flags.stdin) {
      // Read from stdin
      try {
        xanoscript = await this.readStdin()
      } catch (error) {
        this.error(`Failed to read from stdin: ${error}`)
      }
    } else {
      this.error('Either --file or --stdin must be specified to provide XanoScript code')
    }

    // Validate xanoscript is not empty (only if not using URL)
    if (!xanoscriptUrl && (!xanoscript || xanoscript.trim().length === 0)) {
      this.error('XanoScript content is empty')
    }

    // Construct the API URL
    const apiUrl = `${profile.instance_origin}/api:meta/beta/ephemeral/service`

    // Build request body
    const formData = new FormData()
    if (xanoscriptUrl) {
      formData.append('doc', xanoscriptUrl)
    } else {
      formData.append('doc', xanoscript!)
    }

    // Run ephemeral service via API
    try {
      const response = await fetch(apiUrl, {
        body: formData,
        headers: {
          'accept': 'application/json',
          'Authorization': `Bearer ${profile.access_token}`,
        },
        method: 'POST',
      })

      if (!response.ok) {
        const errorText = await response.text()
        this.error(
          `API request failed with status ${response.status}: ${response.statusText}\n${errorText}`,
        )
      }

      const result = await response.json() as EphemeralServiceResponse

      // Output results
      if (flags.output === 'json') {
        this.log(JSON.stringify(result, null, 2))
      } else {
        // summary format
        this.log('Service started successfully!')
        this.log('')
        this.log(`  Service ID: ${result.service.id}`)
        this.log(`  Run ID:     ${result.service.run.id}`)
        this.log('')
        if (result.result) {
          const formatTime = (time: number | undefined) =>
            time === undefined ? 'N/A' : `${(time * 1000).toFixed(2)}ms`
          this.log('  Timing:')
          this.log(`    Boot:     ${formatTime(result.result.boot_time)}`)
          this.log(`    Pre:      ${formatTime(result.result.pre_time)}`)
          this.log('')
          if (result.result.endpoints && result.result.endpoints.length > 0) {
            this.log('  Endpoints:')
            for (const endpoint of result.result.endpoints) {
              this.log(`    ${endpoint.verb.padEnd(6)} ${endpoint.url}`)
              if (endpoint.input.length > 0) {
                for (const input of endpoint.input) {
                  const required = input.required ? '*' : ''
                  const nullable = input.nullable ? '?' : ''
                  this.log(`             └─ ${input.name}${required}: ${input.type}${nullable} (${input.source})`)
                }
              }
            }

            this.log('')
          }

          if (result.result.metadata_api) {
            this.log('  Metadata API:')
            this.log(`    ${result.result.metadata_api.url}`)
          }
        }
      }
    } catch (error) {
      if (error instanceof Error) {
        this.error(`Failed to run ephemeral service: ${error.message}`)
      } else {
        this.error(`Failed to run ephemeral service: ${String(error)}`)
      }
    }
  }

  private async editFile(filePath: string): Promise<string> {
    // Get the EDITOR environment variable
    const editor = process.env.EDITOR || process.env.VISUAL

    if (!editor) {
      this.error(
        'No editor configured. Please set the EDITOR or VISUAL environment variable.\n' +
        'Example: export EDITOR=vim',
      )
    }

    // Validate editor executable exists
    try {
      execSync(`which ${editor.split(' ')[0]}`, {stdio: 'ignore'})
    } catch {
      this.error(
        `Editor '${editor}' not found. Please set EDITOR to a valid editor.\n` +
        'Example: export EDITOR=vim',
      )
    }

    // Read the original file
    let originalContent: string
    try {
      originalContent = fs.readFileSync(filePath, 'utf8')
    } catch (error) {
      this.error(`Failed to read file '${filePath}': ${error}`)
    }

    // Create a temporary file with the same extension
    const ext = path.extname(filePath)
    const tmpFile = path.join(os.tmpdir(), `xano-edit-${Date.now()}${ext}`)

    // Copy content to temp file
    try {
      fs.writeFileSync(tmpFile, originalContent, 'utf8')
    } catch (error) {
      this.error(`Failed to create temporary file: ${error}`)
    }

    // Open the editor
    try {
      execSync(`${editor} ${tmpFile}`, {stdio: 'inherit'})
    } catch (error) {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        // Ignore cleanup errors
      }

      this.error(`Editor exited with an error: ${error}`)
    }

    return tmpFile
  }

  private isUrl(str: string): boolean {
    return str.startsWith('http://') || str.startsWith('https://')
  }

  private loadCredentials(): CredentialsFile {
    const configDir = path.join(os.homedir(), '.xano')
    const credentialsPath = path.join(configDir, 'credentials.yaml')

    // Check if credentials file exists
    if (!fs.existsSync(credentialsPath)) {
      this.error(
        `Credentials file not found at ${credentialsPath}\n` +
        `Create a profile using 'xano profile:create'`,
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

  private async readStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []

      process.stdin.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      process.stdin.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf8'))
      })

      process.stdin.on('error', (error: Error) => {
        reject(error)
      })

      // Resume stdin if it was paused
      process.stdin.resume()
    })
  }
}
