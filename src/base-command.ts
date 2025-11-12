import {Command, Flags} from '@oclif/core'

export default abstract class BaseCommand extends Command {
  static baseFlags = {
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use for this command',
      env: 'XANO_PROFILE',
      required: false,
      default: 'default',
    }),
  }

  // Override the flags property to include baseFlags
  static flags = BaseCommand.baseFlags

  // Helper method to get the profile flag value
  protected getProfile(): string | undefined {
    return (this as any).flags?.profile
  }
}
