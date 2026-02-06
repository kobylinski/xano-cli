import { Args } from '@oclif/core'
import { existsSync, writeFileSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'

import type { XanoObjectType } from '../../lib/types.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import { detectTypeFromPath } from '../../lib/detector.js'
import {
  addSearchEntry,
  getSearchIndexPath,
  loadObjects,
  loadSearchIndex,
  removeSearchEntry,
  saveSearchIndex,
} from '../../lib/objects.js'
import { findProjectRoot } from '../../lib/project.js'

export default class Index extends BaseCommand {
  static args = {
    path: Args.string({
      description: 'File or directory to index (omit for full rebuild)',
      required: false,
    }),
  }
  static description = 'Rebuild search index for fast name resolution'
  static examples = [
    '<%= config.bin %> index',
    '<%= config.bin %> index functions/my_func.xs',
    '<%= config.bin %> index functions/',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Index)
    const agentMode = isAgentMode(flags.agent)

    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      this.error('Not in a xano project. Run "xano init" first.')
    }

    if (args.path) {
      this.incrementalIndex(projectRoot, args.path, agentMode)
    } else {
      this.fullRebuild(projectRoot, agentMode)
    }
  }

  private fullRebuild(projectRoot: string, agentMode: boolean): void {
    const objects = loadObjects(projectRoot)
    saveSearchIndex(projectRoot, objects)

    if (agentMode) {
      this.log(`AGENT_INDEX: full_rebuild`)
      this.log(`AGENT_OBJECTS: ${objects.length}`)
      this.log(`AGENT_COMPLETE: index`)
    } else {
      this.log(`Indexed ${objects.length} objects → .xano/search.json`)
    }
  }

  private incrementalIndex(projectRoot: string, inputPath: string, agentMode: boolean): void {
    // Normalize to relative path
    let relPath = inputPath
    if (isAbsolute(inputPath)) {
      relPath = relative(projectRoot, inputPath)
    }

    // Remove leading ./ if present
    relPath = relPath.replace(/^\.\//, '')

    // Check if this is a directory prefix (index all matching objects)
    const isDirectory = relPath.endsWith('/') || (!relPath.endsWith('.xs') && !relPath.includes('.'))

    // Load or create search index
    let data = loadSearchIndex(projectRoot)
    if (!data) {
      // No existing index — do full rebuild first
      const objects = loadObjects(projectRoot)
      saveSearchIndex(projectRoot, objects)

      if (agentMode) {
        this.log(`AGENT_INDEX: full_rebuild`)
        this.log(`AGENT_OBJECTS: ${objects.length}`)
        this.log(`AGENT_COMPLETE: index`)
      } else {
        this.log(`No search index found — full rebuild: ${objects.length} objects`)
      }

      return
    }

    const objects = loadObjects(projectRoot)
    let updated = 0

    if (isDirectory) {
      // Update all objects whose paths start with this prefix
      const prefix = relPath.endsWith('/') ? relPath : relPath + '/'
      const matching = objects.filter(o => o.path.startsWith(prefix))

      for (const obj of matching) {
        data = removeSearchEntry(data, obj.path)
        data = addSearchEntry(data, obj.path, obj.type)
        updated++
      }

      // Also check for objects in the index that are no longer in objects.json
      const objectPaths = new Set(objects.map(o => o.path))
      const staleEntries = data.objects.filter(
        o => o.path.startsWith(prefix) && !objectPaths.has(o.path),
      )

      for (const stale of staleEntries) {
        data = removeSearchEntry(data, stale.path)
        updated++
      }
    } else {
      // Single file update
      const filePath = relPath.endsWith('.xs') ? relPath : relPath + '.xs'

      // Remove old entry
      data = removeSearchEntry(data, filePath)

      // Determine type: try objects.json first, then detect from path
      const obj = objects.find(o => o.path === filePath)
      const type: null | XanoObjectType = obj?.type ?? detectTypeFromPath(filePath)

      // Only add if the file is tracked or exists on disk
      if (obj || existsSync(filePath)) {
        data = addSearchEntry(data, filePath, type)
        updated = 1
      }
    }

    // Save updated index
    const indexPath = getSearchIndexPath(projectRoot)
    writeFileSync(indexPath, JSON.stringify(data) + '\n', 'utf8')

    if (agentMode) {
      this.log(`AGENT_INDEX: incremental`)
      this.log(`AGENT_UPDATED: ${updated}`)
      this.log(`AGENT_PATH: ${relPath}`)
      this.log(`AGENT_COMPLETE: index`)
    } else {
      this.log(`Updated ${updated} ${updated === 1 ? 'entry' : 'entries'} in search index`)
    }
  }
}
