xano
=================

XanoScript CLI for Xano's Metadata API


[![oclif](https://img.shields.io/badge/cli-oclif-brightgreen.svg)](https://oclif.io)
[![Version](https://img.shields.io/npm/v/xano.svg)](https://npmjs.org/package/xano)
[![Downloads/week](https://img.shields.io/npm/dw/xano.svg)](https://npmjs.org/package/xano)


<!-- toc -->
* [Usage](#usage)
* [Commands](#commands)
<!-- tocstop -->
# Usage
<!-- usage -->
```sh-session
$ npm install -g xano
$ xano COMMAND
running command...
$ xano (--version)
xano/0.0.1 darwin-arm64 node-v22.19.0
$ xano --help [COMMAND]
USAGE
  $ xano COMMAND
...
```
<!-- usagestop -->
# Commands
<!-- commands -->
* [`xano create_api`](#xano-create_api)
* [`xano foo bar [FILE]`](#xano-foo-bar-file)
* [`xano hello PERSON`](#xano-hello-person)
* [`xano hello world`](#xano-hello-world)
* [`xano help [COMMAND]`](#xano-help-command)
* [`xano plugins`](#xano-plugins)
* [`xano plugins add PLUGIN`](#xano-plugins-add-plugin)
* [`xano plugins:inspect PLUGIN...`](#xano-pluginsinspect-plugin)
* [`xano plugins install PLUGIN`](#xano-plugins-install-plugin)
* [`xano plugins link PATH`](#xano-plugins-link-path)
* [`xano plugins remove [PLUGIN]`](#xano-plugins-remove-plugin)
* [`xano plugins reset`](#xano-plugins-reset)
* [`xano plugins uninstall [PLUGIN]`](#xano-plugins-uninstall-plugin)
* [`xano plugins unlink [PLUGIN]`](#xano-plugins-unlink-plugin)
* [`xano plugins update`](#xano-plugins-update)

## `xano create_api`

Create API with the provided key

```
USAGE
  $ xano create_api -k <value>

FLAGS
  -k, --api_key=<value>  [env: XANO_API_KEY]  (required) API key for the service

DESCRIPTION
  Create API with the provided key

EXAMPLES
  hello this is an example
```

_See code: [src/commands/create_api/index.ts](https://github.com/git/xano/blob/v0.0.1/src/commands/create_api/index.ts)_

## `xano foo bar [FILE]`

describe the command here

```
USAGE
  $ xano foo bar [FILE] [-f] [-n <value>]

ARGUMENTS
  FILE  file to read

FLAGS
  -f, --force
  -n, --name=<value>  name to print

DESCRIPTION
  describe the command here

EXAMPLES
  $ xano foo bar
```

_See code: [src/commands/foo/bar.ts](https://github.com/git/xano/blob/v0.0.1/src/commands/foo/bar.ts)_

## `xano hello PERSON`

Say hello

```
USAGE
  $ xano hello PERSON -f <value>

ARGUMENTS
  PERSON  Person to say hello to

FLAGS
  -f, --from=<value>  (required) Who is saying hello

DESCRIPTION
  Say hello

EXAMPLES
  $ xano hello friend --from oclif
  hello friend from oclif! (./src/commands/hello/index.ts)
```

_See code: [src/commands/hello/index.ts](https://github.com/git/xano/blob/v0.0.1/src/commands/hello/index.ts)_

## `xano hello world`

Say hello world

```
USAGE
  $ xano hello world

DESCRIPTION
  Say hello world

EXAMPLES
  $ xano hello world
  hello world! (./src/commands/hello/world.ts)
```

_See code: [src/commands/hello/world.ts](https://github.com/git/xano/blob/v0.0.1/src/commands/hello/world.ts)_

## `xano help [COMMAND]`

Display help for xano.

```
USAGE
  $ xano help [COMMAND...] [-n]

ARGUMENTS
  COMMAND...  Command to show help for.

FLAGS
  -n, --nested-commands  Include all nested commands in the output.

DESCRIPTION
  Display help for xano.
```

_See code: [@oclif/plugin-help](https://github.com/oclif/plugin-help/blob/v6.2.33/src/commands/help.ts)_

## `xano plugins`

List installed plugins.

```
USAGE
  $ xano plugins [--json] [--core]

FLAGS
  --core  Show core plugins.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  List installed plugins.

EXAMPLES
  $ xano plugins
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/index.ts)_

## `xano plugins add PLUGIN`

Installs a plugin into xano.

```
USAGE
  $ xano plugins add PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into xano.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the xano_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the xano_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ xano plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ xano plugins add myplugin

  Install a plugin from a github url.

    $ xano plugins add https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ xano plugins add someuser/someplugin
```

## `xano plugins:inspect PLUGIN...`

Displays installation properties of a plugin.

```
USAGE
  $ xano plugins inspect PLUGIN...

ARGUMENTS
  PLUGIN...  [default: .] Plugin to inspect.

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Displays installation properties of a plugin.

EXAMPLES
  $ xano plugins inspect myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/inspect.ts)_

## `xano plugins install PLUGIN`

Installs a plugin into xano.

```
USAGE
  $ xano plugins install PLUGIN... [--json] [-f] [-h] [-s | -v]

ARGUMENTS
  PLUGIN...  Plugin to install.

FLAGS
  -f, --force    Force npm to fetch remote resources even if a local copy exists on disk.
  -h, --help     Show CLI help.
  -s, --silent   Silences npm output.
  -v, --verbose  Show verbose npm output.

GLOBAL FLAGS
  --json  Format output as json.

DESCRIPTION
  Installs a plugin into xano.

  Uses npm to install plugins.

  Installation of a user-installed plugin will override a core plugin.

  Use the xano_NPM_LOG_LEVEL environment variable to set the npm loglevel.
  Use the xano_NPM_REGISTRY environment variable to set the npm registry.

ALIASES
  $ xano plugins add

EXAMPLES
  Install a plugin from npm registry.

    $ xano plugins install myplugin

  Install a plugin from a github url.

    $ xano plugins install https://github.com/someuser/someplugin

  Install a plugin from a github slug.

    $ xano plugins install someuser/someplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/install.ts)_

## `xano plugins link PATH`

Links a plugin into the CLI for development.

```
USAGE
  $ xano plugins link PATH [-h] [--install] [-v]

ARGUMENTS
  PATH  [default: .] path to plugin

FLAGS
  -h, --help          Show CLI help.
  -v, --verbose
      --[no-]install  Install dependencies after linking the plugin.

DESCRIPTION
  Links a plugin into the CLI for development.

  Installation of a linked plugin will override a user-installed or core plugin.

  e.g. If you have a user-installed or core plugin that has a 'hello' command, installing a linked plugin with a 'hello'
  command will override the user-installed or core plugin implementation. This is useful for development work.


EXAMPLES
  $ xano plugins link myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/link.ts)_

## `xano plugins remove [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ xano plugins remove [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ xano plugins unlink
  $ xano plugins remove

EXAMPLES
  $ xano plugins remove myplugin
```

## `xano plugins reset`

Remove all user-installed and linked plugins.

```
USAGE
  $ xano plugins reset [--hard] [--reinstall]

FLAGS
  --hard       Delete node_modules and package manager related files in addition to uninstalling plugins.
  --reinstall  Reinstall all plugins after uninstalling.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/reset.ts)_

## `xano plugins uninstall [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ xano plugins uninstall [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ xano plugins unlink
  $ xano plugins remove

EXAMPLES
  $ xano plugins uninstall myplugin
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/uninstall.ts)_

## `xano plugins unlink [PLUGIN]`

Removes a plugin from the CLI.

```
USAGE
  $ xano plugins unlink [PLUGIN...] [-h] [-v]

ARGUMENTS
  PLUGIN...  plugin to uninstall

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Removes a plugin from the CLI.

ALIASES
  $ xano plugins unlink
  $ xano plugins remove

EXAMPLES
  $ xano plugins unlink myplugin
```

## `xano plugins update`

Update installed plugins.

```
USAGE
  $ xano plugins update [-h] [-v]

FLAGS
  -h, --help     Show CLI help.
  -v, --verbose

DESCRIPTION
  Update installed plugins.
```

_See code: [@oclif/plugin-plugins](https://github.com/oclif/plugin-plugins/blob/v5.4.49/src/commands/plugins/update.ts)_
<!-- commandsstop -->
