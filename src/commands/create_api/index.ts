import {Args, Flags} from '@oclif/core'
import BaseCommand from '../../base-command.js'

export default class CreateApi extends BaseCommand {
  static args = {
    // api_key: Args.string({
    //   env: 'XANO_API_KEY',
    //   description: 'API key for the service',
    //   required: true,
    // }),
  }

  static override flags = {
    ...BaseCommand.baseFlags,
    // flag with no value (-f, --force)
    access_token: Flags.string({
      char: 't',
      env: 'XANO_ACCESS_TOKEN',
      description: 'Access token for the Xano Metadata API',
      required: true,
    }),
    // flag with a value (-n, --name=VALUE)
    // name: Flags.string({char: 'n', description: 'name to print'}),
  }

  static description = 'Create API swith the provided key'

  static examples = [
    `hello this is an example
`,
  ]

  async run(): Promise<void> {
    const {args, flags} = await this.parse(CreateApi)

    this.log(flags.access_token)
    if (flags.profile) {
      this.log(`Using profile: ${flags.profile}`)
    }
  }
}
