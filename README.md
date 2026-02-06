# Xano CLI

Command-line interface for syncing XanoScript files between your local filesystem and Xano backend.

> **Note:** This is an unofficial fork of [@xano/cli](https://www.npmjs.com/package/@xano/cli) with additional features and improvements.

## Installation

```bash
npm install -g @deligopl/xano-cli
```

## Quick Start

```bash
# Initialize project (creates profile if needed)
xano init

# Pull all files from Xano
xano pull

# Make changes locally, then push
xano push
```

## Project Structure

Example project structure (paths are configurable via `xano.json`):

```
project/
├── xano.json              # Versioned config (commit this)
├── .xano/                  # Local state (gitignore this)
│   ├── config.json         # Branch & workspace info (VSCode compatible)
│   ├── cli.json            # CLI-only settings (naming, profile)
│   ├── objects.json        # Object registry & checksums
│   ├── groups.json         # API group canonical IDs
│   └── datasources.json    # Datasource permissions
├── app/
│   ├── functions/          # XanoScript functions
│   ├── apis/               # API endpoints by group
│   ├── middlewares/        # Middleware
│   └── tasks/              # Scheduled tasks
├── data/
│   ├── tables/             # Table definitions
│   ├── triggers/           # Table triggers
│   └── addons/             # Add-ons
└── tests/                  # Workflow tests
```

## Path Resolution

All file paths are resolved from the current working directory. When in a subdirectory:

```bash
# From project root
xano pull tables/           # Pull all tables

# From within tables/ directory
cd tables
xano pull .                 # Pull only tables (current dir)
xano push users.xs          # Push tables/users.xs
xano data:list users.xs     # List records from tables/users.xs
```

## Core Commands

### Pull & Push

```bash
# Pull all files
xano pull

# Pull specific files or directories
xano pull app/functions/my_function.xs
xano pull app/functions/

# Force fresh metadata sync
xano pull --sync

# Delete local files not on Xano
xano pull --clean

# Push all modified files
xano push

# Push specific files
xano push app/functions/my_function.xs

# Delete objects from Xano not in local
xano push --clean
```

### Status & List

```bash
# Show file status (three-way comparison: local vs synced vs remote)
xano status

# Check specific files or directories
xano status app/functions/my_function.xs
xano status app/functions/

# Show extended info (record counts for tables)
xano status --extended

# Output as JSON
xano status --json

# List remote objects
xano list
xano list app/functions/
xano list app/apis/auth
```

Status indicators:
- `M` - Modified locally
- `M↓` - Modified remotely (pull to update)
- `M!` - Conflict (both local and remote changed)
- `A` - New (local only)
- `D` - Deleted locally
- `D↑` - Deleted remotely
- `R` - Remote only (not pulled)

### Lint

```bash
# Lint all project files
xano lint

# Lint specific files
xano lint app/functions/my_function.xs

# Lint only git-staged files
xano lint --staged
```

### Branch

```bash
xano branch              # Show current
xano branch list         # List all
xano branch v2           # Safe switch (checks sync first)
xano branch v2 --force   # Force switch (skip sync check)
xano branch v2 --sync    # Switch and sync new branch files
```

**Safe switch:** By default, branch switch is blocked if local changes exist. The CLI compares local files against remote state and shows any modifications, local-only files, or remote-only files. Options to resolve:
- `xano push` - push local changes first
- `xano pull --force` - discard local changes
- `xano branch <name> --force` - force switch (may lose changes)

## Data Commands

Work directly with table records. Password fields are automatically hashed.

```bash
# List records (supports table name, ID, or file path)
xano data:list users
xano data:list 271
xano data:list tables/users.xs

# Filter and sort (server-side)
xano data:list users --filter "status=active"
xano data:list users --filter "age>18" --filter "age<65"
xano data:list products --filter "id in 1,2,3"
xano data:list users --sort "created_at:desc"

# Limit displayed columns
xano data:list users --columns "id,email,name"

# View table schema (see also: schema describe columns)
xano data:columns users
xano data:columns tables/users.xs

# Get single record
xano data:get users 1

# Create record
xano data:create users --data '{"email":"test@example.com"}'

# Update single record
xano data:update users 1 --data '{"name":"Updated"}'

# Bulk update by filter
xano data:update users --filter "status=pending" --data '{"status":"active"}' --force
xano data:update users --ids "1,2,3" --data '{"verified":true}' --force

# Delete single record
xano data:delete users 1 --force

# Bulk delete by filter
xano data:delete users --filter "status=deleted" --force
xano data:delete users --ids "1,2,3" --force

# Preview changes (dry-run)
xano data:update users --filter "role=guest" --data '{"role":"user"}' --dry-run
xano data:delete users --filter "last_login<2024-01-01" --dry-run

# Bulk insert
xano data:bulk users --file records.json
xano data:bulk users --file records.json --chunk-size 100

# Truncate table (delete all records)
xano data:truncate users --force

# Use specific data source (environment)
xano data:list users --datasource test
```

**Filter operators:** `=`, `!=`, `>`, `>=`, `<`, `<=`, `in`, `not in`

### Export & Import

```bash
# Export single table
xano data:export users                      # Output to stdout
xano data:export users users.json           # Output to file
xano data:export users backup/users.csv     # Auto-creates directory

# Export with filters
xano data:export users --filter "status=active" --sort "created_at:desc"
xano data:export users --all --format csv   # All records, CSV format

# Batch export (all tables)
xano data:export backup --all               # All tables to backup/
xano data:export --all                      # All tables to export/

# Batch export with filters
xano data:export backup --tags "Users,Auth" # Tables with specific tags
xano data:export backup --tables "users,roles,permissions"

# Import data
xano data:import users.json                 # Auto-detects table from filename
xano data:import users records.json         # Explicit table name
xano data:import users --data '[{"email":"a@test.com"}]'

# Import modes
xano data:import users data.json --mode insert   # Only insert new
xano data:import users data.json --mode update   # Only update existing
xano data:import users data.json --mode upsert   # Insert or update (default)

# Bulk import with chunking
xano data:import users data.json --mode insert --chunk-size 100

# Batch import (directory)
xano data:import backup/                    # Import all JSON/CSV files

# Dry run (preview without executing)
xano data:import users data.json --dry-run
```

### Data Source Management

```bash
xano datasource:list
xano datasource:create staging
xano datasource:delete staging --force
```

## Schema Commands

Granular schema operations with detailed error reporting. Uses SQL-like command structure.

```bash
# View table columns
xano schema describe columns users
xano schema describe columns tables/users.xs
xano schema describe columns users --json

# View table indexes
xano schema describe indexes users
xano schema describe indexes users --json

# Add column
xano schema add column users bio --type text
xano schema add column users age --type int --default 0
xano schema add column users status --type enum --values "active,inactive"
xano schema add column users notes --type text --nullable

# Add column at specific position
xano schema add column users email --type email --after name
xano schema add column users phone --type text --before notes

# Move column to different position
xano schema move column users email --after name
xano schema move column users status --first
xano schema move column users notes --last

# Add index
xano schema add index users --type btree --fields email
xano schema add index users --type unique --fields "email,username"
xano schema add index users --type fulltext --fields bio

# Rename column (with auto-sync of XanoScript)
xano schema rename column users old_name new_name
xano schema rename column users email user_email --no-sync

# Drop column
xano schema drop column users old_column --force
xano schema drop column users temp_field --dry-run

# Drop index (use index number from 'describe indexes')
xano schema drop index users 2 --force
xano schema drop index users 1 --dry-run
```

**Supported column types:** `text`, `int`, `bool`, `timestamp`, `json`, `enum`, `decimal`, `date`, `email`, `password`, `uuid`, `image`, `attachment`, `audio`, `video`, `vector`, `object`, `geo_point`, etc.

**Supported index types:** `btree`, `unique`, `fulltext`, `gin`, `gist`, `hash`

After schema changes, the local XanoScript file is automatically synced (use `--no-sync` to skip).

## Request History

View API request history for debugging.

```bash
# List recent requests
xano history

# Filter by endpoint or status
xano history --endpoint /auth/login
xano history --status 500
xano history --method POST

# View specific request details
xano history:get <request-id>
xano history:get <request-id> --json
```

## API Commands

```bash
# List API groups and endpoints
xano api:groups
xano api:endpoints

# Call an endpoint (auto-resolves API group from path)
xano api:call /auth/login -m POST -b '{"email":"...","password":"..."}'

# Explicit group name
xano api:call auth /login -m POST -b '{"email":"...","password":"..."}'

# Token authentication (adds Authorization: Bearer header)
xano api:call /profile --token "eyJhbG..."
xano api:call /profile --token-file .xano/token.txt

# Extract field and save to file
xano api:call /auth/login -m POST -b '{"email":"...","password":"..."}' \
  --extract .authToken --save .xano/token.txt

# Use saved token for subsequent calls
xano api:call /users --token-file .xano/token.txt
```

## Profile Management

```bash
xano init                    # Interactive setup (recommended)
xano profile:list            # List profiles
xano profile:set-default x   # Set default
```

## Creating New Objects

Create `.xs` files locally and push to create on Xano:

```bash
# Create function
echo 'function my_function { }' > app/functions/my_function.xs
xano push app/functions/my_function.xs

# Create API endpoint (API group must exist first)
xano pull app/apis/auth.xs  # Ensure group exists
echo 'query "endpoint" verb=POST { }' > app/apis/auth/my_endpoint_POST.xs
xano push app/apis/auth/my_endpoint_POST.xs
```

## Configuration

### xano.json (versioned)

The `xano.json` file is created by `xano init` and should be committed to version control. It defines your project's connection to Xano and local file structure.

```json
{
  "instance": "a1b2-c3d4-e5f6",
  "workspace": "My Project",
  "workspaceId": 123,
  "profile": "myprofile",
  "naming": "default",
  "paths": {
    "functions": "app/functions",
    "apis": "app/apis",
    "middlewares": "app/middlewares",
    "tasks": "app/tasks",
    "tables": "data/tables",
    "triggers": "data/triggers",
    "addons": "data/addons",
    "workflow_tests": "tests"
  }
}
```

| Field | Description |
|-------|-------------|
| `instance` | Your Xano instance identifier (from workspace URL) |
| `workspace` | Workspace name (for reference) |
| `workspaceId` | Numeric workspace ID |
| `profile` | Profile name from `~/.xano/credentials.yaml` (optional) |
| `naming` | Naming mode for file paths (see below) |
| `paths` | Local directory mappings for each object type |

**Profile priority:** `--profile` flag > `XANO_PROFILE` env > `profile` in xano.json > `default` in credentials.yaml

### Naming Modes

The `naming` field controls how files are named and organized:

| Mode | Description |
|------|-------------|
| `default` | CLI native structure (recommended for new projects) |
| `vscode` | VSCode extension compatible structure |
| `vscode_name` | Same as `vscode` |
| `vscode_id` | VSCode with numeric ID prefixes |

**Key differences:**

| Object Type | `default` mode | `vscode` mode |
|------------|----------------|---------------|
| API Groups | `apis/{group}.xs` | `apis/{group}/api_group.xs` |
| Triggers | `triggers/{table}/{trigger}.xs` | `triggers/{trigger}.xs` |
| Functions | `functions/{path}.xs` | `functions/{id}_{name}.xs` (with `vscode_id`) |

**Path Configuration:**

All paths are relative to the project root. You can customize them to match your preferred structure:

```json
{
  "naming": "default",
  "paths": {
    "functions": "src/functions",
    "apis": "src/api",
    "tables": "db/schema"
  }
}
```

### xano.js (advanced)

For custom path resolution, use `xano.js` instead of `xano.json`:

```javascript
module.exports = {
  instance: 'a1b2-c3d4-e5f6',
  workspaceId: 123,
  naming: 'default',
  paths: {
    functions: 'app/functions',
    apis: 'app/apis',
    tables: 'data/tables',
    triggers: 'data/triggers'
  },

  // Custom sanitize function (optional)
  // Receives context with: { type, naming, default }
  sanitize(name, context) {
    // Return custom sanitized name, or use default
    return context.default
  },

  // Custom path resolver (optional)
  // Receives context with: { type, naming, default }
  resolvePath(obj, paths, context) {
    // Override specific types
    if (context.type === 'function' && obj.name.startsWith('test_')) {
      return `tests/${obj.name}.xs`
    }
    // Return null to use default path from context
    return null
  }
}
```

**Context object passed to custom functions:**

| Field | Description |
|-------|-------------|
| `type` | Object type (`function`, `table`, `api_endpoint`, etc.) |
| `naming` | Current naming mode (`default`, `vscode`, etc.) |
| `default` | Default result for the current mode |

### Environment Variables

| Variable | Description |
|----------|-------------|
| `XANO_PROFILE` | Default profile |
| `XANO_BRANCH` | Default branch |

### Configuration Files Reference

The CLI uses multiple configuration files with different purposes:

| File | Location | Versioned | Purpose |
|------|----------|-----------|---------|
| `xano.json` | project root | Yes | Project template (human-managed) |
| `config.json` | `.xano/` | No | Local workspace config (VSCode compatible) |
| `cli.json` | `.xano/` | No | CLI-only settings |
| `objects.json` | `.xano/` | No | Object registry |
| `groups.json` | `.xano/` | No | API group canonical IDs |
| `datasources.json` | `.xano/` | No | Datasource permissions |
| `credentials.yaml` | `~/.xano/` | No | Global auth profiles |

**Config load priority** (highest first):
1. `cli.json` - CLI-only settings (naming, profile)
2. `datasources.json` - Datasource settings
3. `config.json` - VSCode-compatible local config
4. `xano.json` - Project template defaults

**VSCode Compatibility Note:** The VSCode extension overwrites `config.json` with only its known keys. CLI-only settings (`naming`, `profile`) are stored separately in `cli.json` to prevent loss.

<details>
<summary><strong>File Structures (click to expand)</strong></summary>

**xano.json** (versioned project template):
```json
{
  "instance": "a1b2-c3d4",
  "workspace": "My Workspace",
  "workspaceId": 123,
  "paths": { "functions": "functions", "apis": "apis", "tables": "tables", "tasks": "tasks", "workflowTests": "workflow_tests" },
  "naming": "default",
  "profile": "myprofile"
}
```

**.xano/config.json** (local config):
```json
{
  "branch": "main",
  "instanceName": "a1b2-c3d4",
  "workspaceId": 123,
  "workspaceName": "My Workspace",
  "paths": { ... }
}
```

**.xano/cli.json** (CLI-only settings):
```json
{
  "naming": "default",
  "profile": "myprofile"
}
```

**.xano/objects.json** (object registry):
```json
[
  {
    "id": 123,
    "path": "functions/my_func.xs",
    "type": "function",
    "status": "unchanged",
    "staged": false,
    "sha256": "abc123...",
    "original": "base64..."
  }
]
```

**.xano/groups.json** (API group canonical IDs):
```json
{
  "bootstrap": { "id": 123, "canonical": "abc123def456" },
  "users": { "id": 456, "canonical": "xyz789abc012" }
}
```

**.xano/datasources.json** (datasource permissions):
```json
{
  "defaultDatasource": "dev",
  "datasources": {
    "live": "read-only",
    "dev": "read-write",
    "staging": "read-write"
  }
}
```

**~/.xano/credentials.yaml** (global credentials):
```yaml
default: myprofile
profiles:
  myprofile:
    instance_origin: https://a1b2-c3d4.xano.io
    access_token: xano_pat_...
```

</details>

**Command → Config Matrix:**

| Command | config.json | cli.json | objects.json | groups.json | datasources.json |
|---------|:-----------:|:--------:|:------------:|:-----------:|:----------------:|
| `init` | W | W | - | - | - |
| `sync/pull/push` | R | R | W | W | - |
| `status` | R | R | R | - | - |
| `api:call` | R | R | R | R | - |
| `data:*` | R | R | - | - | R |
| `datasource:*` | R | - | - | - | W |
| `branch:switch` | W | - | W | W | - |

*R = Read, W = Write, - = Not used*

## Claude Code Integration

Install the skill for AI-assisted development:

```bash
xano skill            # User scope
xano skill --project  # Project scope
```

## MCP Server (Model Context Protocol)

The CLI includes an MCP server for AI model integration with Claude Desktop and Claude Code.

### Available MCP Tools

| Tool | Description |
|------|-------------|
| `xano_project` | Get project info (workspace, paths, object counts) |
| `xano_resolve` | Resolve identifier to workspace file path |
| `xano_search` | Search workspace objects by pattern |
| `xano_inspect` | Parse and analyze a XanoScript file |
| `xano_explain` | Get docs for builtin or workspace object |
| `xano_lint` | Lint a XanoScript file |
| `xano_sync` | Sync metadata from Xano |
| `xano_pull` | Pull files from Xano to local |
| `xano_push` | Push local files to Xano |
| `xano_status` | Get file status (modified, new, unchanged) |
| `xano_api_call` | Call a live Xano API endpoint |
| `xano_tables` | List all tables |
| `xano_data_list` | List records with filtering and sorting |
| `xano_data_*` | Data operations (get, create, update, delete, bulk) |
| `xano_schema_*` | Schema operations (columns, indexes, add, rename, drop) |
| `xano_history` | Get request history for an object |

### Setup

**One command, run from your Xano project directory:**

```bash
cd /path/to/your/xano/project
claude mcp add xano --scope project -- xano mcp --project-root "$(pwd)"
```

This:
1. Creates `.mcp.json` in your project (can be versioned)
2. Captures the absolute project path at setup time
3. Works with both Claude Code and Claude Desktop

**Claude Desktop** also requires adding to `claude_desktop_config.json`:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "xano": {
      "command": "xano",
      "args": ["mcp", "--project-root", "/path/to/your/xano/project"]
    }
  }
}
```

### RPC Server

A JSON-RPC 2.0 server is also available for programmatic access:

```bash
xano rpc
```

Protocol: newline-delimited JSON-RPC 2.0 over stdio.

Available methods: `api.call`, `api.groups`, `config`, `config.set`, `data.*`, `tables`, `sync`, `pull`, `push`, `status`, `shutdown`

## License

MIT
