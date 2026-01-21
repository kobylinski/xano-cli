import { Args, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
// Import xanoscript-lint library
// @ts-expect-error - xanoscript-lint doesn't have TypeScript types
import { XanoScriptValidator } from 'xanoscript-lint/lib/validator.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import {
  findProjectRoot,
  loadLocalConfig,
} from '../../lib/project.js'

export default class Lint extends BaseCommand {
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
    ...BaseCommand.baseFlags,
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
private agentMode = false

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Lint)
    const files = argv as string[]

    this.agentMode = isAgentMode(flags.agent)
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
      if (this.agentMode) {
        this.log('AGENT_LINT_RESULT:')
        this.log('files_checked=0')
        this.log('AGENT_MESSAGE: No .xs files found to lint.')
      } else {
        this.log('No .xs files to lint.')
      }

      return
    }

    if (!this.agentMode) {
      this.log(`Linting ${filesToLint.length} file(s)...\n`)
    }

    // Use xanoscript-lint library for efficient batch validation
    let validator: InstanceType<typeof XanoScriptValidator> | null = null
    let hasErrors = false

    // Collect all diagnostics for agent output
    const allDiagnostics: Array<{
      column: number
      file: string
      line: number
      message: string
      severity: 'error' | 'warning'
    }> = []

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
          if (this.agentMode) {
            allDiagnostics.push({
              column: 1,
              file: relativePath,
              line: 1,
              message: result.error,
              severity: 'error',
            })
          } else {
            this.log(`${relativePath}: error`)
            this.log(`  ❌ ${result.error}`)
          }
        } else if (result.errorCount > 0) {
          if (!this.agentMode) {
            this.log(`${relativePath}: errors`)
          }

          for (const diag of result.diagnostics) {
            if (diag.severity === 'error') {
              if (this.agentMode) {
                allDiagnostics.push({
                  column: diag.column,
                  file: relativePath,
                  line: diag.line,
                  message: diag.message,
                  severity: 'error',
                })
              } else {
                this.log(`  ❌ Line ${diag.line}:${diag.column} - ${diag.message}`)
              }
            }
          }
        } else if (result.warningCount > 0) {
          if (!this.agentMode) {
            this.log(`${relativePath}: warnings`)
          }

          for (const diag of result.diagnostics) {
            if (diag.severity === 'warning') {
              if (this.agentMode) {
                allDiagnostics.push({
                  column: diag.column,
                  file: relativePath,
                  line: diag.line,
                  message: diag.message,
                  severity: 'warning',
                })
              } else {
                this.log(`  ⚠️  Line ${diag.line}:${diag.column} - ${diag.message}`)
              }
            }
          }
        } else if (!this.agentMode) {
          this.log(`${relativePath}: ok`)
        }
      }

      // Summary
      const summary = validator.getSummary()
      hasErrors = summary.hasErrors

      if (this.agentMode) {
        this.log('AGENT_LINT_RESULT:')
        this.log(`files_checked=${summary.totalFiles}`)
        this.log(`errors=${summary.totalErrors}`)
        this.log(`warnings=${summary.totalWarnings}`)
        this.log(`has_errors=${hasErrors}`)

        if (allDiagnostics.length > 0) {
          // Group by severity
          const errors = allDiagnostics.filter(d => d.severity === 'error')
          const warnings = allDiagnostics.filter(d => d.severity === 'warning')

          if (errors.length > 0) {
            this.log('AGENT_LINT_ERRORS:')
            for (const diag of errors.slice(0, 30)) {
              this.log(`- ${diag.file}:${diag.line}:${diag.column}: ${diag.message}`)
            }

            if (errors.length > 30) {
              this.log(`- ... and ${errors.length - 30} more errors`)
            }
          }

          if (warnings.length > 0) {
            this.log('AGENT_LINT_WARNINGS:')
            for (const diag of warnings.slice(0, 20)) {
              this.log(`- ${diag.file}:${diag.line}:${diag.column}: ${diag.message}`)
            }

            if (warnings.length > 20) {
              this.log(`- ... and ${warnings.length - 20} more warnings`)
            }
          }

          if (hasErrors) {
            this.log('AGENT_ACTION: Fix the errors above before pushing to Xano.')
          }
        } else {
          this.log('AGENT_COMPLETE: lint_passed')
          this.log('AGENT_MESSAGE: All files passed linting.')
        }
      } else {
        this.log('')
        this.log(`Checked ${summary.totalFiles} file(s): ${summary.totalErrors} error(s), ${summary.totalWarnings} warning(s)`)
      }
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
