import { Command, Flags } from '@oclif/core'

import { runServer } from '../../mcp/server.js'

export default class Mcp extends Command {
  static description = 'Start the Xano MCP server for AI model integration'
  static examples = [
    '<%= config.bin %> mcp',
    '<%= config.bin %> mcp --project-root /path/to/project',
  ]
static flags = {
    'project-root': Flags.string({
      description: 'Xano project root directory (defaults to XANO_PROJECT_ROOT env or auto-detection)',
      env: 'XANO_PROJECT_ROOT',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Mcp)

    // Set XANO_PROJECT_ROOT env var for the server if flag provided
    if (flags['project-root']) {
      process.env.XANO_PROJECT_ROOT = flags['project-root']
    }

    await runServer()
  }
}

