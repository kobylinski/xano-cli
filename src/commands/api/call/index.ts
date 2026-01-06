import { Args, Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'

export default class ApiCall extends Command {
  static args = {
    canonical: Args.string({
      description: 'API group canonical ID (e.g., "QV7RcVYt")',
      required: true,
    }),
    path: Args.string({
      description: 'Endpoint path (e.g., "/auth/login")',
      required: true,
    }),
  }
  static description = 'Call a live API endpoint'
  static examples = [
    '<%= config.bin %> api:call QV7RcVYt /auth/login --method POST --body \'{"email":"test@example.com","password":"secret"}\'',
    '<%= config.bin %> api:call QV7RcVYt /users --method GET',
    '<%= config.bin %> api:call QV7RcVYt /users --header "Authorization: Bearer <token>"',
    '<%= config.bin %> api:call QV7RcVYt /data --body-file request.json',
  ]
  static flags = {
    body: Flags.string({
      char: 'b',
      description: 'Request body as JSON string',
      exclusive: ['body-file'],
    }),
    'body-file': Flags.string({
      description: 'Read request body from JSON file',
      exclusive: ['body'],
    }),
    header: Flags.string({
      char: 'H',
      description: 'Add header (format: "Name: Value")',
      multiple: true,
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output response as formatted JSON',
    }),
    method: Flags.string({
      char: 'm',
      default: 'GET',
      description: 'HTTP method (GET, POST, PUT, DELETE, PATCH)',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    raw: Flags.boolean({
      default: false,
      description: 'Output raw response (no formatting)',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ApiCall)

    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      this.error('Not in a xano project. Run "xano init" first.')
    }

    if (!isInitialized(projectRoot)) {
      this.error('Project not initialized. Run "xano init" first.')
    }

    const config = loadLocalConfig(projectRoot)
    if (!config) {
      this.error('Failed to load .xano/config.json')
    }

    const profile = getProfile(flags.profile)
    if (!profile) {
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    // Parse headers
    const headers: Record<string, string> = {}
    if (flags.header) {
      for (const h of flags.header) {
        const colonIndex = h.indexOf(':')
        if (colonIndex === -1) {
          this.error(`Invalid header format: "${h}". Use "Name: Value" format.`)
        }
        const name = h.slice(0, colonIndex).trim()
        const value = h.slice(colonIndex + 1).trim()
        headers[name] = value
      }
    }

    // Parse body
    let body: Record<string, unknown> | undefined
    if (flags.body) {
      try {
        body = JSON.parse(flags.body)
      } catch (error: any) {
        this.error(`Invalid JSON body: ${error.message}`)
      }
    } else if (flags['body-file']) {
      try {
        const content = fs.readFileSync(flags['body-file'], 'utf-8')
        body = JSON.parse(content)
      } catch (error: any) {
        this.error(`Failed to read body file: ${error.message}`)
      }
    }

    // Ensure path starts with /
    let endpointPath = args.path
    if (!endpointPath.startsWith('/')) {
      endpointPath = '/' + endpointPath
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    const method = flags.method.toUpperCase()

    const response = await api.callLiveApi(
      args.canonical,
      endpointPath,
      method,
      body,
      Object.keys(headers).length > 0 ? headers : undefined
    )

    if (flags.raw) {
      this.log(JSON.stringify(response.data))
      return
    }

    if (!response.ok) {
      this.log(`Error: ${response.error}`)
      this.log(`Status: ${response.status}`)
      return
    }

    if (flags.json) {
      this.log(JSON.stringify(response.data, null, 2))
      return
    }

    // Pretty print response
    this.log(`Status: ${response.status}`)
    this.log('')
    this.log('Response:')
    this.log(JSON.stringify(response.data, null, 2))
  }
}
