import BaseCommand from '../../base-command.js'

export default class World extends BaseCommand {
  static args = {}
  static description = 'Say hello world'
  static examples = [
    `<%= config.bin %> <%= command.id %>
hello world! (./src/commands/hello/world.ts)
`,
  ]
  static override flags = {
    ...BaseCommand.baseFlags,
  }

  async run(): Promise<void> {
    this.log('hello world! (./src/commands/hello/world.ts)')
  }
}
