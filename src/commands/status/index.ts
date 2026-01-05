import { Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type {
  FileStatus,
  StatusEntry,
  XanoLocalConfig,
  XanoObjectsFile,
  XanoStateFile,
} from '../../lib/types.js'

import {
  computeFileSha256,
  decodeBase64,
  findObjectByPath,
  loadObjects,
} from '../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../lib/project.js'
import {
  getKey,
  loadState,
} from '../../lib/state.js'

export default class Status extends Command {
  static description = 'Show status of local files compared to Xano'
static examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status --json',
  ]
static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Status)

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

    const objects = loadObjects(projectRoot)
    const state = loadState(projectRoot)

    // Collect status entries
    const entries: StatusEntry[] = []

    // Track which paths we've seen
    const seenPaths = new Set<string>()

    // Check all known objects
    for (const obj of objects) {
      seenPaths.add(obj.path)
      const fullPath = path.join(projectRoot, obj.path)

      if (fs.existsSync(fullPath)) {
        // Check if modified
        const currentSha256 = computeFileSha256(fullPath)
        if (currentSha256 === obj.sha256) {
          entries.push({
            id: obj.id,
            key: getKey(state, obj.path),
            path: obj.path,
            status: 'unchanged',
            type: obj.type,
          })
        } else {
          entries.push({
            id: obj.id,
            key: getKey(state, obj.path),
            path: obj.path,
            status: 'modified',
            type: obj.type,
          })
        }
      } else {
        // File deleted locally
        entries.push({
          id: obj.id,
          key: getKey(state, obj.path),
          path: obj.path,
          status: 'deleted',
          type: obj.type,
        })
      }
    }

    // Check for new local files not in objects.json
    const newFiles = this.findNewFiles(projectRoot, config, seenPaths)
    for (const filePath of newFiles) {
      entries.push({
        key: getKey(state, filePath),
        path: filePath,
        status: 'new',
      })
    }

    // Check for orphans (in state.json but not in objects.json and no local file)
    for (const [filePath, stateEntry] of Object.entries(state)) {
      if (!seenPaths.has(filePath) && !newFiles.includes(filePath)) {
        const fullPath = path.join(projectRoot, filePath)
        if (!fs.existsSync(fullPath)) {
          entries.push({
            key: stateEntry.key,
            message: 'In state.json but file and object missing',
            path: filePath,
            status: 'orphan',
          })
        }
      }
    }

    // Output
    if (flags.json) {
      this.log(JSON.stringify(entries, null, 2))
      return
    }

    // Human-readable output
    this.log(`Workspace: ${config.workspaceName}`)
    this.log(`Branch: ${config.branch}`)
    this.log('')

    const modified = entries.filter((e) => e.status === 'modified')
    const newEntries = entries.filter((e) => e.status === 'new')
    const deleted = entries.filter((e) => e.status === 'deleted')
    const orphans = entries.filter((e) => e.status === 'orphan')
    const unchanged = entries.filter((e) => e.status === 'unchanged')

    if (modified.length === 0 && newEntries.length === 0 && deleted.length === 0) {
      this.log('All files in sync.')
    }

    if (modified.length > 0) {
      this.log('Modified (local changes):')
      for (const entry of modified) {
        this.log(`  M ${entry.path}`)
      }

      this.log('')
    }

    if (newEntries.length > 0) {
      this.log('New (not on Xano):')
      for (const entry of newEntries) {
        this.log(`  A ${entry.path}`)
      }

      this.log('')
    }

    if (deleted.length > 0) {
      this.log('Deleted (removed locally, exists on Xano):')
      for (const entry of deleted) {
        this.log(`  D ${entry.path}`)
      }

      this.log('')
    }

    if (orphans.length > 0) {
      this.log('Orphans on Xano (no local file):')
      for (const entry of orphans) {
        this.log(`  ? ${entry.key || entry.path}`)
      }

      this.log('')
    }

    // Summary
    const total = entries.length
    const changedCount = modified.length + newEntries.length + deleted.length
    this.log(`${unchanged.length}/${total} files unchanged, ${changedCount} with changes`)

    if (changedCount > 0) {
      this.log('')
      this.log("Run 'xano push' to push local changes to Xano")
      this.log("Run 'xano pull' to overwrite local with Xano version")
    }
  }

  private findNewFiles(
    projectRoot: string,
    config: XanoLocalConfig,
    knownPaths: Set<string>
  ): string[] {
    const newFiles: string[] = []
    const dirs = [
      config.paths.functions,
      config.paths.apis,
      config.paths.tables,
      config.paths.tasks,
    ]

    for (const dir of dirs) {
      const fullDir = path.join(projectRoot, dir)
      if (fs.existsSync(fullDir)) {
        this.walkDir(fullDir, projectRoot, knownPaths, newFiles)
      }
    }

    return newFiles
  }

  private walkDir(
    dir: string,
    projectRoot: string,
    knownPaths: Set<string>,
    newFiles: string[]
  ): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walkDir(fullPath, projectRoot, knownPaths, newFiles)
      } else if (entry.name.endsWith('.xs')) {
        const relativePath = path.relative(projectRoot, fullPath)
        if (!knownPaths.has(relativePath)) {
          newFiles.push(relativePath)
        }
      }
    }
  }
}
