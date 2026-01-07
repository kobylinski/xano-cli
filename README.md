# Xano CLI

Command-line interface for the Xano Metadata API with project-based sync support.

## Installation

```bash
npm install -g @xano/cli
```

## Quick Start

### New Project

```bash
# Create profile (one-time setup)
xano profile:wizard

# Initialize project in current directory
xano init

# Pull all files from Xano
xano pull
```

### Existing Project (with .xano/ directory)

```bash
# Initialize - creates xano.json from existing .xano/config.json
xano init

# Check status
xano status

# List remote objects
xano list
```

## Project Structure

```
project/
├── xano.json              # Versioned - workspace identity (commit this)
├── .xano/                  # Local state (add to .gitignore)
│   ├── config.json         # Workspace config + current branch
│   └── objects.json        # Object ID mappings (VSCode compatible)
├── functions/              # XanoScript functions
│   └── user/               # Subdirectories from natural text names
│       └── security_events/
├── apis/                   # API endpoints by group
│   ├── auth/
│   └── user/
├── tables/                 # Table definitions
├── tasks/                  # Scheduled tasks
└── workflow_tests/         # Workflow tests
```

## Project Commands

### Initialize

```bash
# Initialize from existing .xano/config.json or xano.json
xano init

# Initialize with specific branch
xano init --branch v2

# Force reinitialize
xano init --force
```

### Pull

```bash
# Pull all files from Xano
xano pull

# Pull specific files or directories
xano pull functions/my_function.xs
xano pull functions/
xano pull functions/ tables/users.xs

# Force fresh metadata sync before pull
xano pull --sync

# Delete local files not on Xano
xano pull --clean

# Combined flags
xano pull functions/ --sync --clean

# Attempt 3-way merge with local changes
xano pull --merge functions/my_function.xs

# Force overwrite local changes
xano pull --force
```

### Push

```bash
# Push all modified files
xano push

# Push specific files or directories
xano push functions/my_function.xs
xano push functions/
xano push apis/ tables/users.xs

# Force fresh metadata sync before push
xano push --sync

# Delete objects from Xano that don't exist locally
xano push --clean

# Combined flags
xano push functions/ --sync --clean
```

### Status

```bash
# Show status (always fetches from Xano)
xano status

# Check specific files or directories
xano status functions/my_function.xs
xano status functions/
xano status functions/ apis/

# Output as JSON
xano status --json
```

Output shows:
- `M` - Modified (local differs from Xano)
- `A` - New (local only, not on Xano)
- `R` - Remote only (on Xano, not local)

### List Remote Objects

```bash
# List all objects on Xano
xano list

# List by type (shell autocomplete works!)
xano list functions/
xano list tables/
xano list apis/
xano list tasks/
xano list workflow_tests/

# Filter APIs by group
xano list apis/auth
xano list apis/user

# Show only objects not pulled locally
xano list --remote-only

# Long format with details
xano list -l

# JSON output
xano list --json
```

### Branch

```bash
# Show current branch
xano branch

# List all branches
xano branch list

# Switch branch
xano branch v2
xano branch live
```

### Lint

```bash
# Lint specific files
xano lint functions/my_function.xs

# Lint directory
xano lint functions/

# Lint git-staged files
xano lint --staged

# Lint all .xs files
xano lint --all
```

Requires `xanoscript-lint` to be installed:
```bash
npm install -g xanoscript-lint
```

## Data Manipulation

Work directly with table records (CRUD operations). Password fields are automatically hashed by Xano.

### List Records

```bash
# List records from a table (by name or ID)
xano data:list users
xano data:list 271

# Pagination
xano data:list users --page 2 --per-page 50

# JSON output
xano data:list users --json
```

### Get Single Record

```bash
# Get record by primary key
xano data:get users 1
xano data:get 271 42

# JSON output
xano data:get users 1 --json
```

### Create Record

```bash
# Create with inline JSON
xano data:create users --data '{"email":"test@example.com","password":"secret123"}'

# Create from file
xano data:create users --file record.json

# JSON output
xano data:create users --data '{"name":"Test"}' --json
```

### Update Record

```bash
# Update with inline JSON
xano data:update users 1 --data '{"name":"Updated Name"}'

# Update from file
xano data:update users 1 --file updates.json
```

### Delete Record

```bash
# Preview what will be deleted
xano data:delete users 1

# Force delete (skip confirmation)
xano data:delete users 1 --force
```

### Bulk Insert

```bash
# Bulk insert from file
xano data:bulk users --file records.json

# Bulk insert with inline JSON array
xano data:bulk users --data '[{"email":"a@example.com"},{"email":"b@example.com"}]'
```

## Live API Calls

Call your Xano API endpoints directly from the CLI.

### List API Groups

```bash
# Get all API groups with canonical IDs
xano api:groups

# JSON output
xano api:groups --json
```

### List API Endpoints

```bash
# List all endpoints
xano api:endpoints

# Filter by group
xano api:endpoints auth

# JSON output
xano api:endpoints --json
```

### Call API Endpoint

```bash
# GET request
xano api:call QV7RcVYt /users --method GET

# POST request with body
xano api:call QV7RcVYt /auth/login --method POST --body '{"email":"test@example.com","password":"secret"}'

# With custom headers
xano api:call QV7RcVYt /protected --header "Authorization: Bearer <token>"

# Read body from file
xano api:call QV7RcVYt /data --method POST --body-file request.json

# Raw output (no formatting)
xano api:call QV7RcVYt /users --raw
```

## Profile Management

Profiles store your Xano credentials in `~/.xano/credentials.yaml`.

```bash
# Create a profile interactively
xano profile:wizard

# Create a profile manually
xano profile:create myprofile -i https://instance.xano.com -t <access_token>

# List profiles
xano profile:list
xano profile:list --details

# Set default profile
xano profile:set-default myprofile

# Edit a profile
xano profile:edit myprofile

# Delete a profile
xano profile:delete myprofile

# Show current user info
xano profile:me
```

## Individual Object Commands

These commands work with numeric IDs (original CLI style):

### Functions

```bash
xano function:list -w 40
xano function:get 145 -o xs
xano function:create -f function.xs
xano function:edit 145
```

### Static Hosts

```bash
xano static_host:list
xano static_host:build:create default -f ./build.zip -n "v1.0.0"
xano static_host:build:list default
```

## Workflow Examples

### Daily Development

```bash
# Start of day - pull any server changes
xano pull

# Work on files locally...

# Check what changed
xano status

# Push changes
xano push functions/my_function.xs

# Or push all modified
xano push
```

### Team Collaboration

```bash
# Someone edited in Xano UI - pull their changes
xano pull functions/shared_util.xs --merge

# Resolve conflicts if any, then push
xano push functions/shared_util.xs
```

### Branch Switching

```bash
# Switch to different Xano branch
xano branch live

# Pull files from new branch (auto-syncs metadata)
xano pull --sync
```

### Clean Slate

```bash
# Force fresh sync and pull everything
xano pull --sync --clean
```

## Configuration Files

### xano.json (versioned)

```json
{
  "instance": "a1b2-c3d4-e5f6",
  "workspace": "My Project",
  "workspaceId": 123,
  "paths": {
    "functions": "functions",
    "tables": "tables",
    "apis": "apis",
    "tasks": "tasks",
    "workflow_tests": "workflow_tests"
  }
}
```

### .xano/config.json (local, gitignored)

```json
{
  "instanceName": "a1b2-c3d4-e5f6",
  "workspaceName": "My Project",
  "workspaceId": 123,
  "branch": "main",
  "paths": { ... }
}
```

### xano.js (dynamic config)

For advanced customization, create `xano.js` instead of `xano.json`:

```javascript
export default {
  instance: "a1b2-c3d4-e5f6",
  workspace: "My Project",
  workspaceId: 123,
  paths: {
    functions: "app/functions",
    apis: "app/apis",
    tables: "db/tables",
    triggers: "db/triggers",
    tasks: "tasks",
    workflow_tests: "tests"
  },

  // Custom path resolver (optional)
  resolvePath(obj, paths) {
    // Custom logic to generate file paths from Xano objects
    if (obj.type === 'function') {
      return `app/functions/${obj.name.toLowerCase()}.xs`
    }
    return null  // Use default
  },

  // Custom type resolver (optional)
  resolveType(inputPath, paths) {
    // Custom logic to resolve CLI input to object types
    if (inputPath === 'database') {
      return ['table', 'table_trigger']
    }
    return null  // Use default
  },

  // Custom sanitize function (optional)
  sanitize(name) {
    return name.toLowerCase().replace(/\s+/g, '_')
  }
}
```

## Type Resolution

When you run `xano pull tables` or `xano status functions/`, the CLI resolves your input to object types based on the `paths` config.

**How it works:**
1. Dynamic resolver (`resolveType` in xano.js) - if defined
2. Match input against configured paths AND any nested paths under it

**Example with config:**
```javascript
paths: {
  functions: 'app/functions',
  tables: 'tables',
  triggers: 'tables/triggers'
}
```

| Input | Matches | Types |
|-------|---------|-------|
| `tables` | `tables` + `triggers` (nested) | `['table', 'table_trigger']` |
| `tables/triggers` | `triggers` only | `['table_trigger']` |
| `tables/triggers/my_trigger.xs` | `triggers` | `['table_trigger']` |
| `tables/users.xs` | `tables` | `['table']` |
| `app/functions` | `functions` | `['function']` |

**Path key to types mapping:**
- `functions` → `['function']`
- `apis` → `['api_endpoint', 'api_group']`
- `tables` → `['table']`
- `triggers` → `['table_trigger']`
- `tasks` → `['task']`
- `workflow_tests` → `['workflow_test']`

## File Naming Convention

Files are named based on their Xano object names, converted to snake_case:

- Functions: `function_name.xs` or `subdirectory/function_name.xs`
- APIs: `group_name/endpoint_path_VERB.xs`
- Tables: `table_name.xs`
- Tasks: `task_name.xs`

Natural text names with slashes become subdirectories:
- `User/Security Events/Log Auth` → `functions/user/security_events/log_auth.xs`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XANO_PROFILE` | Default profile to use |
| `XANO_BRANCH` | Default branch for init |

## Help

```bash
xano --help
xano <command> --help
```
