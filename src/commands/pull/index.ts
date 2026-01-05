import { Command, Flags, Args } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { execSync } from 'node:child_process'
import {
  findProjectRoot,
  loadLocalConfig,
  isInitialized,
} from '../../lib/project.js'
import {
  loadObjects,
  saveObjects,
  findObjectByPath,
  upsertObject,
  computeSha256,
  encodeBase64,
} from '../../lib/objects.js'
import {
  loadState,
  saveState,
  setStateEntry,
} from '../../lib/state.js'
import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  generateKey,
} from '../../lib/detector.js'
import type {
  XanoObjectsFile,
  XanoStateFile,
} from '../../lib/types.js'

export default class Pull extends Command {
  static description = 'Pull XanoScript files from Xano to local'

  static examples = [
    '<%= config.bin %> pull functions/my_function.xs',
    '<%= config.bin %> pull --all',
    '<%= config.bin %> pull --merge functions/my_function.xs',
  ]

  static args = {
    files: Args.string({
      description: 'Files to pull (space-separated)',
      required: false,
    }),
  }

  static strict = false // Allow multiple file arguments

  static flags = {
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    all: Flags.boolean({
      description: 'Pull all files from Xano',
      default: false,
    }),
    force: Flags.boolean({
      char: 'f',
      description: 'Overwrite local changes without confirmation',
      default: false,
    }),
    merge: Flags.boolean({
      description: 'Attempt 3-way merge with local changes',
      default: false,
    }),
    'dry-run': Flags.boolean({
      description: 'Show what would be pulled without actually pulling',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const { flags, argv } = await this.parse(Pull)
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

    let objects = loadObjects(projectRoot)
    let state = loadState(projectRoot)

    // Determine which files to pull
    let filesToPull: string[] = []

    if (flags.all) {
      // Pull all known objects
      filesToPull = objects.map((o) => o.path)
    } else if (files.length > 0) {
      filesToPull = files.map((f) => {
        if (path.isAbsolute(f)) {
          return path.relative(projectRoot, f)
        }
        return f
      })
    } else {
      this.log('No files specified. Use one of:')
      this.log('  xano pull <files...>    - pull specific files')
      this.log('  xano pull --all         - pull all files from Xano')
      return
    }

    if (filesToPull.length === 0) {
      this.log('No files to pull.')
      return
    }

    this.log(`Pulling ${filesToPull.length} file(s) from Xano...`)
    this.log(`  Workspace: ${config.workspaceName}`)
    this.log(`  Branch: ${config.branch}`)
    this.log('')

    if (flags['dry-run']) {
      this.log('Dry run - files that would be pulled:')
      for (const file of filesToPull) {
        const obj = findObjectByPath(objects, file)
        if (obj) {
          this.log(`  ${file} (id: ${obj.id})`)
        } else {
          this.log(`  ${file} (not in objects.json - skipped)`)
        }
      }
      return
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    let successCount = 0
    let errorCount = 0
    let skippedCount = 0

    for (const file of filesToPull) {
      const obj = findObjectByPath(objects, file)

      if (!obj) {
        this.log(`  - ${file}: Not in objects.json (run "xano sync" first)`)
        skippedCount++
        continue
      }

      const result = await this.pullFile(
        projectRoot,
        file,
        obj.id,
        obj.type,
        api,
        objects,
        state,
        flags.force,
        flags.merge
      )

      if (result.success) {
        objects = result.objects
        state = result.state
        successCount++
        this.log(`  ✓ ${file}`)
      } else if (result.skipped) {
        skippedCount++
        this.log(`  - ${file}: ${result.error}`)
      } else {
        errorCount++
        this.log(`  ✗ ${file}: ${result.error}`)
      }
    }

    // Save updated state
    saveObjects(projectRoot, objects)
    saveState(projectRoot, state)

    this.log('')
    this.log(`Pulled: ${successCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`)
  }

  private async pullFile(
    projectRoot: string,
    filePath: string,
    id: number,
    type: string,
    api: XanoApi,
    objects: XanoObjectsFile,
    state: XanoStateFile,
    force: boolean,
    merge: boolean
  ): Promise<{
    success: boolean
    skipped?: boolean
    error?: string
    objects: XanoObjectsFile
    state: XanoStateFile
  }> {
    const fullPath = path.join(projectRoot, filePath)

    // Fetch from Xano
    const response = await api.getObject(type as any, id)

    if (!response.ok || !response.data?.xanoscript) {
      return {
        success: false,
        error: response.error || 'Failed to fetch from Xano',
        objects,
        state,
      }
    }

    const serverContent = response.data.xanoscript
    const serverSha256 = computeSha256(serverContent)

    // Check if local file exists and has changes
    if (fs.existsSync(fullPath) && !force) {
      const localContent = fs.readFileSync(fullPath, 'utf-8')
      const localSha256 = computeSha256(localContent)
      const obj = findObjectByPath(objects, filePath)

      // Check if local has uncommitted changes
      if (obj && localSha256 !== obj.sha256) {
        if (merge) {
          // Attempt merge
          const mergeResult = this.attemptMerge(
            projectRoot,
            fullPath,
            localContent,
            serverContent,
            obj.original
          )

          if (!mergeResult.success) {
            return {
              success: false,
              error: mergeResult.error || 'Merge failed',
              objects,
              state,
            }
          }

          // Merged content is in the file
          const mergedContent = fs.readFileSync(fullPath, 'utf-8')
          const key = generateKey(mergedContent) || `${type}:${path.basename(filePath, '.xs')}`

          objects = upsertObject(objects, filePath, {
            id,
            type: type as any,
            status: mergeResult.hasConflicts ? 'modified' : 'unchanged',
            staged: false,
            sha256: computeSha256(mergedContent),
            original: encodeBase64(serverContent),
          })

          state = setStateEntry(state, filePath, {
            key,
            etag: response.etag,
          })

          if (mergeResult.hasConflicts) {
            return {
              success: true,
              error: 'Merged with conflicts - please resolve manually',
              objects,
              state,
            }
          }

          return { success: true, objects, state }
        } else {
          return {
            success: false,
            skipped: true,
            error: 'Local changes exist. Use --force to overwrite or --merge to attempt merge.',
            objects,
            state,
          }
        }
      }
    }

    // Write file
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(fullPath, serverContent, 'utf-8')

    const key = generateKey(serverContent) || `${type}:${path.basename(filePath, '.xs')}`

    // Update objects.json
    objects = upsertObject(objects, filePath, {
      id,
      type: type as any,
      status: 'unchanged',
      staged: false,
      sha256: serverSha256,
      original: encodeBase64(serverContent),
    })

    // Update state.json
    state = setStateEntry(state, filePath, {
      key,
      etag: response.etag,
    })

    return { success: true, objects, state }
  }

  private attemptMerge(
    projectRoot: string,
    filePath: string,
    localContent: string,
    serverContent: string,
    originalBase64: string
  ): { success: boolean; hasConflicts: boolean; error?: string } {
    try {
      // Decode base content
      const baseContent = Buffer.from(originalBase64, 'base64').toString('utf-8')

      // Create temp files for merge
      const tmpDir = fs.mkdtempSync(path.join(projectRoot, '.xano-merge-'))
      const basePath = path.join(tmpDir, 'base.xs')
      const localPath = path.join(tmpDir, 'local.xs')
      const serverPath = path.join(tmpDir, 'server.xs')

      fs.writeFileSync(basePath, baseContent)
      fs.writeFileSync(localPath, localContent)
      fs.writeFileSync(serverPath, serverContent)

      try {
        // Use git merge-file
        execSync(`git merge-file -p "${localPath}" "${basePath}" "${serverPath}" > "${filePath}"`, {
          cwd: projectRoot,
          encoding: 'utf-8',
        })

        // Clean up
        fs.rmSync(tmpDir, { recursive: true })
        return { success: true, hasConflicts: false }
      } catch (mergeError: any) {
        // git merge-file returns non-zero if there are conflicts
        // but still produces output with conflict markers
        if (mergeError.status === 1) {
          // Copy the merged file with conflicts
          const mergedContent = fs.readFileSync(localPath, 'utf-8')
          fs.writeFileSync(filePath, mergedContent)

          // Clean up
          fs.rmSync(tmpDir, { recursive: true })
          return { success: true, hasConflicts: true }
        }

        // Clean up
        fs.rmSync(tmpDir, { recursive: true })
        return { success: false, hasConflicts: false, error: 'Git merge-file failed' }
      }
    } catch (error: any) {
      return { success: false, hasConflicts: false, error: error.message }
    }
  }
}
