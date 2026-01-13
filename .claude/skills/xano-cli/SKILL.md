---
name: xano-cli
description: Xano CLI tool for syncing XanoScript files between local filesystem and Xano backend. Use when working with Xano projects, pushing/pulling XanoScript, managing functions, APIs, tables, or tasks.
---

# Xano CLI Guide

This skill provides guidance for using the xano-cli tool to manage XanoScript files locally and sync them with Xano backend.

## Overview

The xano-cli enables version control and local development of XanoScript files. It maintains a bidirectional sync between your local filesystem and Xano workspace.

## Project Structure

```
project/
├── xano.json              # Project config (versioned, commit this)
├── .xano/                  # Local state (add to .gitignore)
│   ├── config.json         # Local config with branch info
│   └── objects.json        # Object mappings and checksums
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

## Essential Commands

### Initialize a Project

```bash
# Initialize in current directory
xano init

# Initialize with specific branch
xano init --branch v2

# Force reinitialize
xano init --force
```

### Pull from Xano

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

### Push to Xano

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

### Check Status

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

Status indicators:
- `M` - Modified (local differs from Xano)
- `A` - New (local only, not on Xano)
- `R` - Remote only (on Xano, not local)

### List Remote Objects

```bash
# List all objects on Xano
xano list

# List by type
xano list functions/
xano list tables/
xano list apis/
xano list tasks/
xano list workflow_tests/

# Filter APIs by group
xano list apis/auth

# Show only objects not pulled locally
xano list --remote-only

# Long format with details
xano list -l

# JSON output
xano list --json
```

### Branch Management

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
# Lint all project files (default)
xano lint

# Lint specific files
xano lint functions/my_function.xs

# Lint directory
xano lint functions/

# Lint only git-staged files
xano lint --staged
```

## Creating New Objects from Local Files

The CLI supports creating new Xano objects by pushing local `.xs` files that don't exist in Xano yet.

### How It Works

1. Create a `.xs` file in the appropriate directory
2. The file content **MUST** start with the correct XanoScript keyword for type detection
3. Run `xano push <path>` to create the object in Xano

### XanoScript Keywords for Type Detection

The CLI detects object type from the **first non-comment line** of the file:

| Keyword | Object Type |
|---------|-------------|
| `function ` | Function |
| `query ` | API Endpoint |
| `api_group ` | API Group |
| `table ` | Table |
| `table_trigger ` | Table Trigger |
| `task ` | Task |
| `workflow_test ` | Workflow Test |
| `addon ` | Add-on |
| `middleware ` | Middleware |

### Examples of New Object Files

**Function** (`app/functions/my_new_function.xs`):
```xanoscript
function my_new_function {
  // function body
}
```

**Add-on** (`data/addons/my_addon.xs`):
```xanoscript
addon my_addon {
  // addon body
}
```

**Middleware** (`app/middlewares/auth_check.xs`):
```xanoscript
middleware auth_check {
  // middleware body
}
```

**Table Trigger** (`data/triggers/users/on_create.xs`):
```xanoscript
table_trigger on_create on users after_insert {
  // trigger body
}
```

**API Endpoint** (`app/apis/auth/login_POST.xs`):
```xanoscript
query POST /auth/login {
  // endpoint body
}
```

### Creating New API Endpoints

**Important:** API endpoints require their API group to exist first. The CLI looks up the API group from the file path.

```bash
# Example: Creating a new endpoint in the "bootstrap" API group

# 1. Ensure the API group exists (pull it or check objects.json)
xano pull app/apis/bootstrap.xs

# 2. Create the new endpoint file
# Path must be: app/apis/{group_name}/{endpoint}_VERB.xs
cat > app/apis/bootstrap/mfa_challenge_POST.xs << 'EOF'
query "mfa/challenge" verb=POST {
  api_group = "Bootstrap"

  input {
    text code
  }

  stack {
    // implementation
  }

  response = {success: true}
}
EOF

# 3. Push the new endpoint
xano push app/apis/bootstrap/mfa_challenge_POST.xs
```

**If API group not found:**
```
Cannot find API group for new endpoint. Expected "bootstrap.xs" file in apis directory.
Create the API group first or run "xano pull --sync".
```

**Solution:** Pull the API group first with `xano pull --sync` or ensure `app/apis/{group_name}.xs` exists in `objects.json`.

### Creating a New Object

```bash
# 1. Create the file with correct XanoScript structure
echo 'addon membership_assignments {
  // addon logic here
}' > data/addons/membership_assignments.xs

# 2. Push the file to Xano (creates new object)
xano push data/addons/membership_assignments.xs

# 3. Or push all new files in a directory
xano push data/addons/
```

### Troubleshooting New Object Creation

**"Cannot detect XanoScript type"**
- The file must start with a valid keyword (e.g., `function `, `addon `, `middleware `)
- Comments are allowed before the keyword line
- Check for typos in the keyword

**Object not detected as new**
- Ensure the file is in a configured directory (check `xano.json` paths)
- Run `xano push --sync <path>` to force metadata refresh

## Workflow Examples

### Daily Development Workflow

1. Start by pulling latest changes:
   ```bash
   xano pull
   ```

2. Check what you're working with:
   ```bash
   xano status
   ```

3. Edit XanoScript files locally with your IDE

4. Push changes when ready:
   ```bash
   xano push functions/my_function.xs
   ```

### Starting a New Feature

1. Pull to ensure you have latest:
   ```bash
   xano pull
   ```

2. Create new XanoScript file locally

3. Push to create on Xano:
   ```bash
   xano push functions/new_feature.xs
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

### Resolving Conflicts

When local and remote have diverged:

```bash
# Try automatic merge
xano pull --merge functions/conflicted.xs

# Or force overwrite with remote
xano pull --force functions/conflicted.xs

# Or push local version (overwrites remote)
xano push functions/conflicted.xs
```

## Profile Management

Profiles store Xano credentials for different instances:

```bash
# Interactive profile setup
xano profile:wizard

# List profiles
xano profile:list

# Use specific profile
xano push --profile production functions/my_function.xs
```

## Data Manipulation

Work directly with table records (CRUD operations). Password fields are automatically hashed by Xano.

```bash
# List records from a table
xano data:list users
xano data:list users --page 2 --per-page 50

# Get single record by primary key
xano data:get users 1
xano data:get users 1 --json

# Create a new record (passwords are auto-hashed)
xano data:create users --data '{"email":"test@example.com","password":"secret123"}'
xano data:create users --file record.json

# Update an existing record
xano data:update users 1 --data '{"name":"Updated Name"}'

# Delete a record
xano data:delete users 1 --force

# Bulk insert multiple records
xano data:bulk users --file records.json
xano data:bulk users --data '[{"email":"a@example.com"},{"email":"b@example.com"}]'

# Bulk insert with custom primary keys (e.g., UUIDs)
xano data:bulk users --file records.json --allow-id
```

### Using Data Sources (Environments)

All data commands support the `--datasource` flag to target specific environments (e.g., "live", "test"):

```bash
# Work with test data source
xano data:list users --datasource test
xano data:create users --data '{"email":"test@test.local"}' --datasource test
xano data:delete users 1 --force --datasource test

# Manage data sources
xano datasource:list
xano datasource:create staging
xano datasource:delete staging --force
```

This is useful for:
- Setting up test fixtures without affecting live data
- Running integration tests against isolated data
- Comparing data between environments

## Live API Calls

Call your Xano API endpoints directly from the CLI. API groups are auto-resolved from endpoint paths.

```bash
# List API groups and endpoints
xano api:groups
xano api:endpoints

# Call an endpoint (auto-resolves API group)
xano api:call /auth/login --method POST --body '{"email":"test@example.com","password":"secret"}'

# Explicit group name
xano api:call Bootstrap /auth/login --method POST --body '{"email":"...","password":"..."}'

# With custom headers
xano api:call /protected --header "Authorization: Bearer <token>"

# Read body from file
xano api:call /data --method POST --body-file request.json
```

### Token Authentication

Use `--token` or `--token-file` for authenticated endpoints:

```bash
# Direct token
xano api:call /profile --token "eyJhbG..."

# Token from file
xano api:call /profile --token-file .xano/token.txt
```

The `--token` flag adds `Authorization: Bearer <token>` header automatically.

### Extracting and Saving Responses

Use `--extract` with JSONPath syntax to extract specific fields:

```bash
# Extract a field from response
xano api:call /auth/login -m POST -b '{"email":"...","password":"..."}' --extract .authToken

# Extract nested field
xano api:call /users/1 --extract .data.user.email

# Extract array element
xano api:call /users --extract .items[0].id
```

Use `--save` to write output to file (works with or without `--extract`):

```bash
# Save extracted token to file
xano api:call /auth/login -m POST -b '{"email":"...","password":"..."}' \
  --extract .authToken \
  --save .xano/token.txt

# Save full response
xano api:call /users --save /tmp/users.json
```

### Agent Workflow: Complete Auth Flow

```bash
# 1. Login and save token
xano api:call /auth/login -m POST \
  -b '{"email":"test@example.com","password":"secret"}' \
  --extract .authToken \
  --save .xano/token.txt

# 2. Use saved token for authenticated calls
xano api:call /profile --token-file .xano/token.txt
xano api:call /users --token-file .xano/token.txt

# 3. Clean up
rm .xano/token.txt
```

### Testing Auth Flows

Pattern for testing authentication:

```bash
# 1. Create a test user
xano data:create users --data '{"email":"test@example.com","password":"testpass123"}'

# 2. Login and save token
xano api:call /auth/login -m POST \
  -b '{"email":"test@example.com","password":"testpass123"}' \
  --extract .authToken \
  --save .xano/token.txt

# 3. Use token for authenticated calls
xano api:call /me --token-file .xano/token.txt

# 4. Clean up
xano data:delete users <user_id> --force
rm .xano/token.txt
```

## Tips

1. **Use `xano status` frequently** to see what's changed

2. **Push small, focused changes** rather than large batches

3. **Keep .xano/ in .gitignore** - it contains local state

4. **Commit xano.json to git** - it defines the project

5. **Use data commands for testing** - quickly create/delete test records

6. **Use api:call for integration testing** - test your API endpoints directly

7. **Use --sync flag** when metadata might be stale or after branch switch

8. **Use `xano status`** to preview what would change before pull/push

## Custom Configuration (xano.js)

For advanced setups, create `xano.js` instead of `xano.json`:

```javascript
export default {
  instance: "a1b2-c3d4-e5f6",
  workspaceId: 123,
  paths: {
    functions: "app/functions",
    tables: "db/tables",
    triggers: "db/triggers"
  },

  // Custom type resolver (optional)
  resolveType(inputPath, paths) {
    if (inputPath === "database") return ["table", "table_trigger"]
    return null  // Use default
  }
}
```

## Type Resolution

Commands like `xano pull tables` resolve input to object types based on the `paths` config.

**How it works:**
1. Dynamic resolver (`resolveType` in xano.js) - if defined
2. Match input against configured paths AND any nested paths under it

**Example:**
```javascript
paths: { tables: 'tables', triggers: 'tables/triggers' }
```
- `xano pull tables` → matches `tables` + `triggers` → `['table', 'table_trigger']`
- `xano pull tables/triggers` → matches `triggers` only → `['table_trigger']`

**Path key → types:**
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
- `User/Security Events/Log Auth` -> `functions/user/security_events/log_auth.xs`

## Environment Variables

- `XANO_PROFILE` - Default profile to use
- `XANO_BRANCH` - Default branch

## Troubleshooting

### "Not in a xano project"
Run `xano init` to initialize the project.

### "No profile found"
Run `xano profile:wizard` to create credentials.

### Push fails with validation error
Check the XanoScript syntax. Run `xano lint <file>` to validate.

### Files show as modified but unchanged
Run `xano pull --sync` to refresh the baseline.

### Missing objects.json
The CLI will auto-sync metadata when objects.json is missing. You can also run `xano pull --sync` manually.
