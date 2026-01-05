import { Args, Command, Flags } from '@oclif/core'
import { execSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

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
static description = 'Lint XanoScript files using xs-lint'
static examples = [
    '<%= config.bin %> lint functions/my_function.xs',
    '<%= config.bin %> lint functions/',
    '<%= config.bin %> lint --staged',
    '<%= config.bin %> lint --all',
  ]
static flags = {
    all: Flags.boolean({
      default: false,
      description: 'Lint all .xs files in project',
    }),
    fix: Flags.boolean({
      default: false,
      description: 'Attempt to fix issues (if supported)',
    }),
    staged: Flags.boolean({
      default: false,
      description: 'Lint git-staged .xs files',
    }),
  }
static strict = false // Allow multiple file arguments

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Lint)
    const files = argv as string[]

    // Check if xs-lint is available
    if (!this.isXsLintAvailable()) {
      this.error(
        'xs-lint not found. Install it with:\n\n' +
        '  npm install -g xanoscript-lint\n\n' +
        'Then run "xs-setup" to configure it.'
      )
    }

    const projectRoot = findProjectRoot() || process.cwd()

    // Determine which files to lint
    let filesToLint: string[] = []

    if (flags.staged) {
      filesToLint = this.getGitStagedFiles(projectRoot)
    } else if (flags.all) {
      filesToLint = this.getAllXsFiles(projectRoot)
    } else if (files.length > 0) {
      filesToLint = this.expandFiles(projectRoot, files)
    } else {
      this.log('No files specified. Use one of:')
      this.log('  xano lint <files...>    Lint specific files')
      this.log('  xano lint <directory>/  Lint all .xs files in directory')
      this.log('  xano lint --staged      Lint git-staged .xs files')
      this.log('  xano lint --all         Lint all .xs files in project')
      return
    }

    if (filesToLint.length === 0) {
      this.log('No .xs files to lint.')
      return
    }

    this.log(`Linting ${filesToLint.length} file(s)...\n`)

    // Run xs-lint on each file
    let errorCount = 0
    let warningCount = 0

    for (const file of filesToLint) {
      const result = this.lintFile(projectRoot, file)

      if (result.hasErrors) {
        errorCount++
      }

      if (result.hasWarnings) {
        warningCount++
      }
    }

    // Summary
    this.log('')
    if (errorCount === 0 && warningCount === 0) {
      this.log('All files passed.')
    } else {
      this.log(`Lint complete: ${errorCount} error(s), ${warningCount} warning(s)`)
      if (errorCount > 0) {
        this.exit(1)
      }
    }
  }

  private expandFiles(projectRoot: string, inputs: string[]): string[] {
    const files: string[] = []

    for (const input of inputs) {
      // Trim trailing slash
      const cleaned = input.replace(/\/$/, '')
      const fullPath = path.isAbsolute(cleaned)
        ? cleaned
        : path.join(projectRoot, cleaned)

      if (!fs.existsSync(fullPath)) {
        this.warn(`Path not found: ${input}`)
        continue
      }

      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        this.walkDir(fullPath, projectRoot, files)
      } else if (fullPath.endsWith('.xs')) {
        files.push(path.relative(projectRoot, fullPath))
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
      const fullDir = path.join(projectRoot, dir)
      if (fs.existsSync(fullDir)) {
        this.walkDir(fullDir, projectRoot, files)
      }
    }

    return files
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
      this.warn('Failed to get git staged files.')
      return []
    }
  }

  private isXsLintAvailable(): boolean {
    try {
      execSync('which xs-lint', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  private lintFile(
    projectRoot: string,
    file: string
  ): { hasErrors: boolean; hasWarnings: boolean } {
    const fullPath = path.join(projectRoot, file)

    try {
      const result = spawnSync('xs-lint', [fullPath], {
        cwd: projectRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const output = (result.stdout || '') + (result.stderr || '')

      if (result.status === 0) {
        // Check if output contains warnings
        if (output.includes('warning')) {
          this.log(`${file}: warnings`)
          this.log(output)
          return { hasErrors: false, hasWarnings: true }
        }

        this.log(`${file}: ok`)
        return { hasErrors: false, hasWarnings: false }
      }
 
        this.log(`${file}: errors`)
        if (output) {
          this.log(output)
        }

        return { hasErrors: true, hasWarnings: false }
      
    } catch (error: any) {
      this.log(`${file}: failed to lint (${error.message})`)
      return { hasErrors: true, hasWarnings: false }
    }
  }

  private walkDir(dir: string, projectRoot: string, files: string[]): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walkDir(fullPath, projectRoot, files)
      } else if (entry.name.endsWith('.xs')) {
        files.push(path.relative(projectRoot, fullPath))
      }
    }
  }
}
