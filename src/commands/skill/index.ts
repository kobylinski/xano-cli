import { Command, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findProjectRoot } from '../../lib/project.js'

const SKILL_NAME = 'xano-cli'

// Get the package root directory
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PACKAGE_ROOT = resolve(__dirname, '..', '..', '..')
const SKILL_SOURCE = join(PACKAGE_ROOT, '.claude', 'skills', 'xano-cli', 'SKILL.md')

export default class Skill extends Command {
  static description = 'Install Claude Code skill for xano-cli usage guidance'
static examples = [
    '<%= config.bin %> skill',
    '<%= config.bin %> skill --user',
    '<%= config.bin %> skill --project',
    '<%= config.bin %> skill --uninstall',
  ]
static flags = {
    project: Flags.boolean({
      description: 'Install skill in project scope (.claude/skills/)',
      exclusive: ['user'],
    }),
    uninstall: Flags.boolean({
      description: 'Uninstall the skill',
    }),
    user: Flags.boolean({
      default: true,
      description: 'Install skill in user scope (~/.claude/skills/)',
      exclusive: ['project'],
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Skill)

    // Determine scope - project flag overrides default user
    const isProjectScope = flags.project === true

    // Determine target directory
    let skillDir: string

    if (isProjectScope) {
      const projectRoot = findProjectRoot() || process.cwd()
      skillDir = join(projectRoot, '.claude', 'skills', SKILL_NAME)
    } else {
      skillDir = join(homedir(), '.claude', 'skills', SKILL_NAME)
    }

    const skillFile = join(skillDir, 'SKILL.md')

    if (flags.uninstall) {
      if (existsSync(skillDir)) {
        rmSync(skillDir, { recursive: true })
        this.log(`Uninstalled skill from: ${skillDir}`)
      } else {
        this.log(`Skill not found at: ${skillDir}`)
      }

      return
    }

    // Read skill content from package
    if (!existsSync(SKILL_SOURCE)) {
      this.error(`Skill source not found: ${SKILL_SOURCE}`)
    }

    const skillContent = readFileSync(SKILL_SOURCE, 'utf8')

    // Create directory if needed
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true })
    }

    // Write skill file
    writeFileSync(skillFile, skillContent, 'utf8')

    const scope = isProjectScope ? 'project' : 'user'
    this.log(`Installed xano-cli skill (${scope} scope)`)
    this.log(`  Location: ${skillFile}`)
    this.log('')
    this.log('Restart Claude Code to load the skill.')
    this.log('The skill will activate when you ask about Xano CLI usage.')
  }
}
