import { Command } from '@oclif/core'

export default class ProfileWizard extends Command {
  static description = '[DEPRECATED] Use "xano init" or "xano init profile" instead'
static examples = [
    '<%= config.bin %> init              # Full setup',
    '<%= config.bin %> init profile      # Profile management only',
  ]
static hidden = true

  async run(): Promise<void> {
    this.warn('profile:wizard is deprecated. Use "xano init" or "xano init profile" instead.')
    this.log('')

    // Redirect to init profile
    await this.config.runCommand('init', ['profile'])
  }
}
