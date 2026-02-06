import { Command } from '@oclif/core'

import { runRpcServer } from '../../rpc/server.js'

export default class Rpc extends Command {
  static description = `Start a JSON-RPC 2.0 server over stdio

Protocol: JSON-RPC 2.0, newline-delimited (stdin/stdout)

Startup signal:
  {"ready":true,"version":"1.0"}

Methods:
  config                 Get current config
                         Params: {}
                         Result: {profile, datasource, branch, workspace}

  config.set             Set profile and/or datasource
                         Params: {profile?, datasource?}
                         Result: {profile, datasource}

  api.call               Call a live API endpoint
                         Params: {method, path, body?, headers?, apiGroup?}
                         Result: {ok, status, data?, error?}

  api.groups             List available API groups
                         Params: {}
                         Result: [{name, canonical, baseUrl}]

  tables                 List all tables
                         Params: {page?, perPage?}
                         Result: {ok, tables: [{id, name}]}

  data.list              List table records
                         Params: {table, page?, perPage?}
                         Result: {ok, data, pagination}

  data.get               Get a single record
                         Params: {table, id}
                         Result: {ok, data?, error?}

  data.create            Create a new record
                         Params: {table, data}
                         Result: {ok, data?, error?}

  data.update            Update a record
                         Params: {table, id, data}
                         Result: {ok, data?, error?}

  data.delete            Delete a record
                         Params: {table, id}
                         Result: {ok, error?}

  data.bulk              Bulk create records
                         Params: {table, records}
                         Result: {ok, data?, error?}

  shutdown               Graceful shutdown
                         Params: {}
                         Result: {ok: true} then exit

Notes:
  - "table" param accepts ID (number) or name (string)
  - "datasource" from config.set applies to all data operations
  - Stderr used for logs, stdout for protocol
  - Exits on stdin EOF or shutdown method`
static examples = [
    {
      command: '<%= config.bin %> rpc',
      description: 'Start RPC server',
    },
    {
      command: 'echo \'{"jsonrpc":"2.0","method":"config","id":1}\' | <%= config.bin %> rpc',
      description: 'Get current config',
    },
    {
      command: 'echo \'{"jsonrpc":"2.0","method":"tables","id":1}\' | <%= config.bin %> rpc',
      description: 'List tables',
    },
  ]

  async run(): Promise<void> {
    await runRpcServer()
  }
}
