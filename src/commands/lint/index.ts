import { Args, Command, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
// Import xanoscript-lint library
// @ts-expect-error - xanoscript-lint doesn't have TypeScript types
import { XanoScriptValidator } from 'xanoscript-lint/lib/validator.js'

import {
  findProjectRoot,
  loadLocalConfig,
} from '../../lib/project.js'

export default class Lint extends Command {
  static args = {
    files: Args.string({
      description: 'Files or directories to lint',
      required: false,
    }),
  }
static description = 'Lint XanoScript files'
static examples = [
    '<%= config.bin %> lint',
    '<%= config.bin %> lint functions/my_function.xs',
    '<%= config.bin %> lint functions/',
    '<%= config.bin %> lint --staged',
  ]
static flags = {
    fix: Flags.boolean({
      default: false,
      description: 'Attempt to fix issues (if supported)',
    }),
    staged: Flags.boolean({
      default: false,
      description: 'Lint only git-staged .xs files',
    }),
  }
static strict = false // Allow multiple file arguments

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Lint)
    const files = argv as string[]

    const projectRoot = findProjectRoot() || process.cwd()

    // Determine which files to lint
    let filesToLint: string[] = []

    if (flags.staged) {
      filesToLint = this.getGitStagedFiles(projectRoot)
    } else if (files.length > 0) {
      filesToLint = this.expandFiles(projectRoot, files)
    } else {
      // Default: lint all .xs files in project
      filesToLint = this.getAllXsFiles(projectRoot)
    }

    if (filesToLint.length === 0) {
      this.log('No .xs files to lint.')
      return
    }

    this.log(`Linting ${filesToLint.length} file(s)...\n`)

    // Use xanoscript-lint library for efficient batch validation
    let validator: InstanceType<typeof XanoScriptValidator> | null = null
    let hasErrors = false

    try {
      validator = new XanoScriptValidator()
      await validator.start()

      // Convert relative paths to absolute paths
      const absolutePaths = filesToLint.map((f) => join(projectRoot, f))

      // Validate all files with single LSP instance
      const results = await validator.validateFiles(absolutePaths)

      // Display results
      for (const [i, result] of results.entries()) {
        const relativePath = filesToLint[i]

        if (result.error) {
          this.log(`${relativePath}: error`)
          this.log(`  ❌ ${result.error}`)
        } else if (result.errorCount > 0) {
          this.log(`${relativePath}: errors`)
          for (const diag of result.diagnostics) {
            if (diag.severity === 'error') {
              this.log(`  ❌ Line ${diag.line}:${diag.column} - ${diag.message}`)
            }
          }
        } else if (result.warningCount > 0) {
          this.log(`${relativePath}: warnings`)
          for (const diag of result.diagnostics) {
            if (diag.severity === 'warning') {
              this.log(`  ⚠️  Line ${diag.line}:${diag.column} - ${diag.message}`)
            }
          }
        } else {
          this.log(`${relativePath}: ok`)
        }
      }

      // Summary
      const summary = validator.getSummary()
      this.log('')
      this.log(`Checked ${summary.totalFiles} file(s): ${summary.totalErrors} error(s), ${summary.totalWarnings} warning(s)`)

      hasErrors = summary.hasErrors
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Lint failed: ${message}`)
    } finally {
      if (validator) {
        await validator.shutdown()
      }
    }

    if (hasErrors) {
      this.exit(1)
    }
  }

  private expandFiles(projectRoot: string, inputs: string[]): string[] {
    const files: string[] = []

    for (const input of inputs) {
      // Trim trailing slash
      const cleaned = input.replace(/\/$/, '')
      // Resolve from cwd first, so "." in a subdirectory means that subdirectory
      const fullPath = resolve(cleaned)

      if (!existsSync(fullPath)) {
        this.warn(`Path not found: ${input}`)
        continue
      }

      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        this.walkDir(fullPath, projectRoot, files)
      } else if (fullPath.endsWith('.xs')) {
        files.push(relative(projectRoot, fullPath))
      }
    }

    return files
  }

  private getAllXsFiles(projectRoot: string): string[] {
    const config = loadLocalConfig(projectRoot)
    const dirs = config
      ? [config.paths.functions, config.paths.tables, config.paths.apis, config.paths.tasks]
      : ['functions', 'tables', 'apis', 'tasks']

    const files: string[] = []
    for (const dir of dirs) {
      const fullDir = join(projectRoot, dir)
      if (existsSync(fullDir)) {
        this.walkDir(fullDir, projectRoot, files)
      }
    }

    return files
  }

  private getGitStagedFiles(projectRoot: string): string[] {
    try {
      const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
        cwd: projectRoot,
        encoding: 'utf8',
      })
      return output
        .split('\n')
        .filter((f) => f.endsWith('.xs'))
        .filter(Boolean)
    } catch {
      this.warn('Failed to get git staged files.')
      return []
    }
  }

  private walkDir(dir: string, projectRoot: string, files: string[]): void {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walkDir(fullPath, projectRoot, files)
      } else if (entry.name.endsWith('.xs')) {
        files.push(relative(projectRoot, fullPath))
      }
    }
  }
}
