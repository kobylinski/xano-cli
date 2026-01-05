import { Args, Command, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type {
  XanoObjectsFile,
  XanoObjectType,
  XanoStateFile,
} from '../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  detectType,
  generateKey,
} from '../../lib/detector.js'
import {
  computeFileSha256,
  computeSha256,
  encodeBase64,
  findObjectByPath,
  loadObjects,
  saveObjects,
  upsertObject,
} from '../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../lib/project.js'
import {
  getStateEntry,
  loadState,
  saveState,
  setStateEntry,
} from '../../lib/state.js'

export default class Push extends Command {
  static args = {
    files: Args.string({
      description: 'Files to push (space-separated)',
      required: false,
    }),
  }
static description = 'Push local XanoScript files to Xano'
static examples = [
    '<%= config.bin %> push functions/my_function.xs',
    '<%= config.bin %> push --staged',
    '<%= config.bin %> push --all',
    '<%= config.bin %> push --force functions/my_function.xs',
  ]
static flags = {
    all: Flags.boolean({
      default: false,
      description: 'Push all modified/new .xs files',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Show what would be pushed without actually pushing',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force push (skip etag conflict check)',
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    staged: Flags.boolean({
      default: false,
      description: 'Push git-staged .xs files',
    }),
  }
static strict = false // Allow multiple file arguments

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Push)
    const files = argv as string[]

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

    // Determine which files to push
    let filesToPush: string[] = []

    if (flags.staged) {
      filesToPush = this.getGitStagedFiles(projectRoot)
    } else if (flags.all) {
      filesToPush = this.getAllChangedFiles(projectRoot)
    } else if (files.length > 0) {
      filesToPush = files.map((f) => {
        // Convert to relative path if absolute
        if (path.isAbsolute(f)) {
          return path.relative(projectRoot, f)
        }

        return f
      })
    } else {
      this.log('No files specified. Use one of:')
      this.log('  xano push <files...>    - push specific files')
      this.log('  xano push --staged      - push git-staged .xs files')
      this.log('  xano push --all         - push all modified/new .xs files')
      return
    }

    if (filesToPush.length === 0) {
      this.log('No files to push.')
      return
    }

    this.log(`Pushing ${filesToPush.length} file(s) to Xano...`)
    this.log(`  Workspace: ${config.workspaceName}`)
    this.log(`  Branch: ${config.branch}`)
    this.log('')

    if (flags['dry-run']) {
      this.log('Dry run - files that would be pushed:')
      for (const file of filesToPush) {
        this.log(`  ${file}`)
      }

      return
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    let objects = loadObjects(projectRoot)
    let state = loadState(projectRoot)

    let successCount = 0
    let errorCount = 0

    for (const file of filesToPush) {
      const result = await this.pushFile(
        projectRoot,
        file,
        api,
        objects,
        state,
        flags.force
      )

      if (result.success) {
        objects = result.objects
        state = result.state
        successCount++
        this.log(`  ✓ ${file}`)
      } else {
        errorCount++
        this.log(`  ✗ ${file}: ${result.error}`)
      }
    }

    // Save updated state
    saveObjects(projectRoot, objects)
    saveState(projectRoot, state)

    this.log('')
    this.log(`Pushed: ${successCount}, Errors: ${errorCount}`)
  }

  private getAllChangedFiles(projectRoot: string): string[] {
    const objects = loadObjects(projectRoot)
    const changedFiles: string[] = []

    // Check existing objects for modifications
    for (const obj of objects) {
      const fullPath = path.join(projectRoot, obj.path)
      if (fs.existsSync(fullPath)) {
        const currentSha256 = computeFileSha256(fullPath)
        if (currentSha256 !== obj.sha256) {
          changedFiles.push(obj.path)
        }
      }
    }

    // Find new files
    const config = loadLocalConfig(projectRoot)
    if (config) {
      const knownPaths = new Set(objects.map((o) => o.path))
      const dirs = [
        config.paths.functions,
        config.paths.apis,
        config.paths.tables,
        config.paths.tasks,
      ]

      for (const dir of dirs) {
        const fullDir = path.join(projectRoot, dir)
        if (fs.existsSync(fullDir)) {
          this.walkDir(fullDir, projectRoot, knownPaths, changedFiles)
        }
      }
    }

    return changedFiles
  }

  private getGitStagedFiles(projectRoot: string): string[] {
    try {
      const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
        cwd: projectRoot,
        encoding: 'utf-8',
      })
      return output
        .split('\n')
        .filter((f) => f.endsWith('.xs'))
        .filter(Boolean)
    } catch {
      this.warn('Failed to get git staged files. Is this a git repository?')
      return []
    }
  }

  private async pushFile(
    projectRoot: string,
    filePath: string,
    api: XanoApi,
    objects: XanoObjectsFile,
    state: XanoStateFile,
    force: boolean
  ): Promise<{
    error?: string
    objects: XanoObjectsFile
    state: XanoStateFile
    success: boolean
  }> {
    const fullPath = path.join(projectRoot, filePath)

    if (!fs.existsSync(fullPath)) {
      return { error: 'File not found', objects, state, success: false }
    }

    const content = fs.readFileSync(fullPath, 'utf8')
    const type = detectType(content)

    if (!type) {
      return { error: 'Cannot detect XanoScript type', objects, state, success: false }
    }

    const existingObj = findObjectByPath(objects, filePath)
    const key = generateKey(content) || `${type}:${path.basename(filePath, '.xs')}`

    let newId: number
    let etag: string | undefined

    if (existingObj?.id) {
      // Update existing object
      // TODO: Check etag for conflicts if not force
      const response = await api.updateObject(type, existingObj.id, content)

      if (!response.ok) {
        return { error: response.error || 'Update failed', objects, state, success: false }
      }

      newId = existingObj.id
      etag = response.etag
    } else {
      // Create new object
      const response = await api.createObject(type, content)

      if (!response.ok) {
        // Try to find by key and update instead
        if (response.status === 409 || response.error?.includes('already exists')) {
          return {
            error: 'Object already exists on Xano. Run "xano sync" to update mappings.',
            objects,
            state,
            success: false,
          }
        }

        return { error: response.error || 'Create failed', objects, state, success: false }
      }

      if (!response.data?.id) {
        return { error: 'No ID returned from API', objects, state, success: false }
      }

      newId = response.data.id
      etag = response.etag
    }

    // Update objects.json
    objects = upsertObject(objects, filePath, {
      id: newId,
      original: encodeBase64(content),
      sha256: computeSha256(content),
      staged: false,
      status: 'unchanged',
      type,
    })

    // Update state.json
    state = setStateEntry(state, filePath, {
      etag,
      key,
    })

    return { objects, state, success: true }
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
