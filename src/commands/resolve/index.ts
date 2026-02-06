import { Args } from '@oclif/core'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import { findProjectRoot } from '../../lib/project.js'
import { resolveIdentifier } from '../../lib/xs-resolver.js'

export default class Resolve extends BaseCommand {
  static args = {
    identifier: Args.string({
      description: 'Identifier to resolve (function name, endpoint, table, etc.)',
      required: true,
    }),
  }
  static description = 'Resolve an identifier to a workspace file path'
  static examples = [
    '<%= config.bin %> resolve brands_POST',
    '<%= config.bin %> resolve my_function',
    '<%= config.bin %> resolve Discord/GetMessageByID',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Resolve)
    const { identifier } = args
    const agentMode = isAgentMode(flags.agent)

    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      if (agentMode) {
        this.log(JSON.stringify({ error: 'not_in_xano_project' }))
      } else {
        this.error('Not in a Xano project. Run "xano init" first.')
      }

      return
    }

    const resolved = resolveIdentifier(identifier, projectRoot)

    if (resolved.length === 0) {
      if (agentMode) {
        this.log(JSON.stringify({ error: 'not_found', query: identifier }))
      } else {
        this.error(`No workspace object found for "${identifier}"`)
      }

      return
    }

    // Output the best match (or all matches in JSON)
    const best = resolved[0]

    if (agentMode) {
      this.log(JSON.stringify({
        filePath: best.filePath,
        matchType: best.matchType,
        name: best.name,
        type: best.type,
      }))
    } else {
      this.log(`${best.name} (${best.type || 'unknown'})`)
      this.log(`File: ${best.filePath}`)
      if (resolved.length > 1) {
        this.log('')
        this.log(`${resolved.length - 1} additional matches:`)
        for (const match of resolved.slice(1)) {
          this.log(`  ${match.filePath}`)
        }
      }
    }
  }
}
