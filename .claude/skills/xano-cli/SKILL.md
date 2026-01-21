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

## Path Resolution (Important for Agents)

**All file paths are resolved from the current working directory (cwd), not the project root.**

This means when you're in a subdirectory:
- `.` refers to the current directory, not the project root
- Relative paths are resolved from where you are

```bash
# From project root
xano pull tables/               # Pulls all tables
xano status .                   # Status of entire project

# From within tables/ directory
cd tables
xano pull .                     # Pulls only tables (current dir)
xano status .                   # Status of only tables
xano push users.xs              # Pushes tables/users.xs
xano data:list users.xs         # Lists records from tables/users.xs
xano schema describe columns accounts.xs   # Shows schema of tables/accounts.xs

# From within apis/auth/ directory
cd apis/auth
xano push .                     # Pushes only auth API endpoints
xano pull login_POST.xs         # Pulls apis/auth/login_POST.xs
```

**This applies to all commands:** `pull`, `push`, `status`, `lint`, `history`, `data:list`, `schema describe columns`

## Essential Commands

### Initialize a Project

**Before initialization:**
- If git is detected in the directory, ensure all local code is committed before running `xano init`. The init process may create or modify files that you'll want to track separately from your existing work.

```bash
# Check git status first
git status

# Commit any pending changes
git add . && git commit -m "Pre-xano init checkpoint"

# Then initialize
xano init
```

**Naming mode selection during initialization:**

When initializing a project, determine the appropriate naming mode:

1. **Determine automatically if possible:**
   - If existing `.xs` files are present, analyze their structure
   - Check for VSCode-style patterns (flat triggers, api_group.xs files, ID prefixes)
   - Check for CLI-style patterns (nested triggers, flat API group files)

2. **Propose resolution:**
   - If naming mode can be determined: **confirm** with user (e.g., "Detected VSCode naming pattern. Use `naming: vscode`?")
   - If naming mode cannot be determined: **decide** by asking user to choose (e.g., "Select naming mode: default (CLI) or vscode?")
   - For new empty projects: recommend `default` mode

```bash
# Initialize in current directory
xano init

# Initialize with specific branch
xano init --branch v2

# Force reinitialize
xano init --force
```

After successful initialization, consider installing the Claude Code skill:
```bash
xano skill --project
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

The status command performs three-way comparison: local files vs synced state (objects.json) vs remote Xano.

```bash
# Show status (compares local, synced, and remote)
xano status

# Check specific files or directories (smart fetching - only fetches needed objects)
xano status functions/my_function.xs
xano status functions/
xano status functions/ apis/

# Show extended info (record counts for tables)
xano status --extended

# Output as JSON
xano status --json
```

Status indicators:
- `M` - Modified locally (local differs from synced)
- `M↓` - Modified remotely (remote differs from synced, pull to update)
- `M!` - Conflict (both local and remote changed independently)
- `A` - New (local only, not on Xano)
- `D` - Deleted locally (was synced, now deleted locally)
- `D↑` - Deleted remotely (was synced, now deleted on Xano)
- `R` - Remote only (on Xano, not pulled locally)

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

# Safe switch (blocks if local changes exist)
xano branch v2

# Force switch (skip sync check - may lose local changes)
xano branch v2 --force

# Switch and auto-sync new branch files
xano branch v2 --sync
```

**Safe branch switching:** By default, `xano branch <name>` checks if local files are in sync with remote before allowing the switch. If modifications, local-only, or remote-only files are detected, the switch is blocked with a summary of changes and resolution options.

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
# Safe switch (checks sync status first)
xano branch live

# If blocked due to local changes:
xano push                    # Push changes first, or
xano pull --force            # Discard local changes, or
xano branch live --force     # Force switch

# Switch and auto-sync in one command
xano branch live --sync
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
# Interactive profile setup (recommended)
xano init

# List profiles
xano profile:list

# Use specific profile
xano push --profile production functions/my_function.xs
```

## Data Manipulation

Work directly with table records (CRUD operations). Password fields are automatically hashed by Xano.

### Listing and Searching Records

```bash
# List records from a table (by name, ID, or file path)
xano data:list users
xano data:list 271
xano data:list tables/users.xs

# Filter records (server-side filtering)
xano data:list users --filter "status=active"
xano data:list users --filter "age>18" --filter "age<65"
xano data:list orders --filter "price>100"
xano data:list products --filter "id in 1,2,3"
xano data:list users --filter "role not in admin,superuser"

# Sort records
xano data:list users --sort "created_at:desc"
xano data:list users --sort "name:asc" --sort "id:desc"

# Limit displayed columns
xano data:list users --columns "id,email,name"

# Combine filters, sort, columns, and pagination
xano data:list users --filter "status=active" --sort "created_at:desc" --columns "id,email" --per-page 50

# Pagination
xano data:list users --page 2 --per-page 50
```

**Filter operators:**
| Operator | Example | Description |
|----------|---------|-------------|
| `=` | `status=active` | Exact match |
| `!=` | `status!=deleted` | Not equal |
| `>` | `age>18` | Greater than |
| `>=` | `price>=100` | Greater or equal |
| `<` | `count<10` | Less than |
| `<=` | `score<=100` | Less or equal |
| `in` | `id in 1,2,3` | In array |
| `not in` | `role not in admin,super` | Not in array |

### Viewing Table Schema

```bash
# Show column definitions (by name, ID, or file path)
xano schema describe columns users
xano schema describe columns 271
xano schema describe columns tables/users.xs
xano schema describe columns users --json

# Show table indexes
xano schema describe indexes users
xano schema describe indexes users --json
```

### Single Record Operations

```bash
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

# Truncate table (delete all records)
xano data:truncate users --force

# Bulk insert multiple records
xano data:bulk users --file records.json
xano data:bulk users --data '[{"email":"a@example.com"},{"email":"b@example.com"}]'

# Bulk insert with custom primary keys (e.g., UUIDs)
xano data:bulk users --file records.json --allow-id
```

### Bulk Update & Delete

Update or delete multiple records using filters or ID lists.

```bash
# Bulk update by filter (updates all matching records)
xano data:update users --filter "status=pending" --data '{"status":"active"}' --force
xano data:update users --filter "role=guest" --filter "created_at<2024-01-01" --data '{"role":"archived"}' --force

# Bulk update by ID list
xano data:update users --ids "1,2,3,4,5" --data '{"verified":true}' --force

# Bulk delete by filter
xano data:delete users --filter "status=deleted" --force
xano data:delete users --filter "last_login<2024-01-01" --force

# Bulk delete by ID list
xano data:delete users --ids "1,2,3,4,5" --force

# Preview changes without executing (dry-run)
xano data:update users --filter "role=guest" --data '{"role":"user"}' --dry-run
xano data:delete users --filter "status=inactive" --dry-run
```

**Notes:**
- Filters use the same syntax as `data:list` (`field=value`, `field>value`, `field in a,b,c`)
- Multiple `--filter` flags are combined with AND logic
- Progress is displayed every 100 records for bulk operations
- Use `--dry-run` to preview what would be affected before executing

### Export & Import

Export and import table data to/from JSON or CSV files.

```bash
# Export single table
xano data:export users                      # Output to stdout (JSON)
xano data:export users users.json           # Output to file
xano data:export users backup/users.csv     # Auto-creates directory, CSV format

# Export with filters and sorting
xano data:export users --filter "status=active" --sort "created_at:desc"
xano data:export users --all --format csv   # All records (paginated), CSV format
xano data:export users --columns "id,email,name"  # Specific columns only

# Batch export (all tables to directory)
xano data:export backup --all               # All tables to backup/
xano data:export --all                      # All tables to export/

# Batch export with filters
xano data:export backup --tags "Users,Auth" # Only tables with these tags
xano data:export backup --tables "users,roles,permissions"  # Specific tables

# Import data
xano data:import users.json                 # Auto-detects table from filename
xano data:import users records.json         # Explicit table name
xano data:import users --data '[{"email":"a@test.com"}]'

# Import modes
xano data:import users data.json --mode insert   # Only insert new records
xano data:import users data.json --mode update   # Only update existing records
xano data:import users data.json --mode upsert   # Insert or update (default)

# Bulk import with chunking (for large datasets)
xano data:import users data.json --mode insert --chunk-size 100

# Batch import (all JSON/CSV files from directory)
xano data:import backup/                    # Import matching table names

# Dry run (preview without executing)
xano data:import users data.json --dry-run
```

### Using Data Sources (Environments)

All data commands support the `--datasource` flag to target specific environments (e.g., "live", "test"):

```bash
# Work with test data source
xano data:list users --datasource test
xano data:create users --data '{"email":"test@test.local"}' --datasource test
xano data:delete users 1 --force --datasource test
xano data:export users backup/users.json --datasource test
xano data:import users data.json --datasource test

# Manage data sources on Xano (remote)
xano datasource:list
xano datasource:create staging
xano datasource:delete staging --force
```

This is useful for:
- Setting up test fixtures without affecting live data
- Running integration tests against isolated data
- Comparing data between environments
- Backing up/restoring test data

### Datasource Configuration (Local)

Configure default datasource and access permissions locally in `xano.json`:

```bash
# Set default datasource for all data commands
xano datasource:default test          # Set "test" as default
xano datasource:default               # Show current default
xano datasource:default --clear       # Remove default (use Xano's "live")

# Configure access permissions
xano datasource:permission            # List all permissions
xano datasource:permission live       # Show permission for "live"
xano datasource:permission live locked              # Block all access
xano datasource:permission live read-only           # Allow only reads
xano datasource:permission test read-write          # Allow read and write
xano datasource:permission live --clear             # Remove custom permission
```

**Access levels:**
| Level | Read | Write |
|-------|------|-------|
| `locked` | No | No |
| `read-only` | Yes | No |
| `read-write` | Yes | Yes |

Unconfigured datasources default to `read-only` for safety.

### Agent Datasource Policy

**Important for AI agents:** Datasource configuration is protected in agent mode to prevent accidental operations on wrong environments.

**Blocked in agent mode:**
- `xano datasource:default <name>` - Setting/clearing default datasource
- `xano datasource:permission <name> <level>` - Setting/clearing permissions
- `--datasource` flag override on data commands

**Allowed in agent mode (read-only):**
- `xano datasource:default` - View current default
- `xano datasource:permission` - List all permissions
- `xano datasource:permission <name>` - View specific permission

When an agent attempts a blocked operation:
```
AGENT_ERROR: datasource_config_blocked
AGENT_MESSAGE: Agents cannot modify datasource configuration.
AGENT_ACTION: Ask the human to run this command manually.
AGENT_COMMAND: xano datasource:default test
```

**Recommended workflow for agents:**
1. Check current default: `xano datasource:default`
2. If wrong datasource, ask user to run: `xano datasource:default <name>`
3. Never rely on `--datasource` flag - it will be ignored
4. Data operations will use the configured default automatically

## Schema Operations

Granular schema manipulation with detailed error reporting. Uses SQL-like command structure. These commands provide better error messages than pushing entire XanoScript files when schema changes fail.

### Viewing Schema

```bash
# View table columns (from API, not local file)
xano schema describe columns users
xano schema describe columns tables/users.xs
xano schema describe columns users --json

# View table indexes
xano schema describe indexes users
xano schema describe indexes users --json
```

### Adding Columns

```bash
# Add a new column
xano schema add column users bio --type text
xano schema add column users age --type int --default 0
xano schema add column users notes --type text --nullable

# Add enum column with values
xano schema add column users status --type enum --values "active,inactive,pending"

# Add column with description
xano schema add column users metadata --type json --description "User metadata"

# Add sensitive column (marked as sensitive in schema)
xano schema add column users ssn --type text --sensitive

# Add column at specific position
xano schema add column users email --type email --after name
xano schema add column users phone --type text --before notes
```

**Supported column types:** `text`, `int`, `bool`, `timestamp`, `json`, `enum`, `decimal`, `date`, `email`, `password`, `uuid`, `image`, `attachment`, `audio`, `video`, `vector`, `object`, `geo_point`, `geo_polygon`, `geo_linestring`, `geo_multipoint`, `geo_multilinestring`, `geo_multipolygon`

### Moving Columns

```bash
# Move column after another column
xano schema move column users email --after name

# Move column before another column
xano schema move column users created_at --before updated_at

# Move column to first position (after id)
xano schema move column users status --first

# Move column to last position
xano schema move column users notes --last
```

### Adding Indexes

```bash
# Add btree index (default)
xano schema add index users --type btree --fields email

# Add unique constraint
xano schema add index users --type unique --fields "email,username"

# Add fulltext index for text search
xano schema add index users --type fulltext --fields bio

# Add GIN index for JSON columns
xano schema add index users --type gin --fields metadata
```

**Supported index types:** `btree`, `unique`, `fulltext`, `gin`, `gist`, `hash`

### Renaming Columns

```bash
# Rename a column (atomic operation with clear error reporting)
xano schema rename column users old_name new_name

# Skip auto-sync of XanoScript after rename
xano schema rename column users email user_email --no-sync
```

If the rename fails (e.g., column has dependencies), the error message will explain why:
```
Error: Cannot rename column 'email'
  - Column has unique index that must be dropped first
  - Referenced by foreign key in 'orders.user_email'
```

### Dropping Columns

```bash
# Drop a column (requires --force)
xano schema drop column users old_field --force

# Preview deletion without executing
xano schema drop column users temp_column --dry-run

# Skip auto-sync after deletion
xano schema drop column users unused_field --force --no-sync
```

**Important:** Dropping a column permanently removes all data in that column. The `--dry-run` flag shows what would be deleted before executing.

### Dropping Indexes

```bash
# Drop an index by number (get index numbers from 'describe indexes')
xano schema drop index users 2 --force

# Preview deletion
xano schema drop index users 1 --dry-run
```

### Auto-Sync Behavior

After schema changes (rename, add column, drop column, add index, drop index), the local XanoScript file is automatically synced from Xano to reflect the changes. Use `--no-sync` to skip this behavior if you want to manage files manually.

## Request History

View API request history for debugging and analysis.

```bash
# List recent requests
xano history

# Filter requests
xano history --endpoint /auth/login         # By endpoint path
xano history --status 500                   # By HTTP status code
xano history --method POST                  # By HTTP method
xano history --per-page 50                  # Pagination

# View specific request details
xano history:get <request-id>
xano history:get <request-id> --json        # JSON output
```

Useful for:
- Debugging failed API calls
- Analyzing request/response patterns
- Auditing API usage

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

1. **Paths resolve from current directory** - When in a subdirectory, `.` means that directory, not project root. Use `xano pull .` to pull only current directory.

2. **Use `xano status` frequently** to see what's changed - it performs three-way comparison and shows conflicts

3. **Use `xano status --extended`** to see table record counts alongside file status

4. **Push small, focused changes** rather than large batches

5. **Keep .xano/ in .gitignore** - it contains local state

6. **Commit xano.json to git** - it defines the project

7. **Use data commands for testing** - quickly create/delete test records, filter with `--filter`, check schema with `schema describe columns`

8. **Use api:call for integration testing** - test your API endpoints directly

9. **Use --sync flag** when metadata might be stale or after branch switch

10. **Use file paths for data commands** - `xano data:list users.xs` works when in the tables directory

11. **Backup data with export** - `xano data:export backup --all` exports all tables to JSON files

12. **Use tags for selective export** - `xano data:export backup --tags "Public"` exports only tagged tables

13. **Debug with history** - `xano history --status 500` shows failed requests for troubleshooting

14. **Use dry-run for import** - `xano data:import data.json --dry-run` previews changes without executing

## Naming Modes

The CLI supports different naming modes for file organization via the `naming` field in config:

| Mode | Description |
|------|-------------|
| `default` | CLI native structure (recommended for new projects) |
| `vscode` | VSCode extension compatible structure |
| `vscode_name` | Same as `vscode` |
| `vscode_id` | VSCode with numeric ID prefixes |

**Key differences between modes:**

| Object Type | `default` mode | `vscode` mode |
|------------|----------------|---------------|
| API Groups | `apis/{group}.xs` | `apis/{group}/api_group.xs` |
| Triggers | `triggers/{table}/{trigger}.xs` | `triggers/{trigger}.xs` |
| Functions | `functions/{path}.xs` | `functions/{id}_{name}.xs` (with `vscode_id`) |

Example configuration:
```json
{
  "instance": "a1b2-c3d4-e5f6",
  "workspaceId": 123,
  "profile": "myprofile",
  "naming": "default",
  "paths": {
    "functions": "app/functions",
    "apis": "app/apis",
    "triggers": "data/triggers"
  }
}
```

**Profile priority:** `--profile` flag > `XANO_PROFILE` env > `profile` in xano.json > `default` in credentials.yaml

## Custom Configuration (xano.js)

For advanced setups with custom path resolution, create `xano.js` instead of `xano.json`:

```javascript
module.exports = {
  instance: "a1b2-c3d4-e5f6",
  workspaceId: 123,
  profile: "myprofile",
  naming: "default",
  paths: {
    functions: "app/functions",
    tables: "db/tables",
    triggers: "db/triggers"
  },

  // Custom sanitize function (optional)
  // Receives context: { type, naming, default }
  sanitize(name, context) {
    // Return custom sanitized name, or use context.default
    return context.default
  },

  // Custom path resolver (optional)
  // Receives context: { type, naming, default }
  resolvePath(obj, paths, context) {
    // Override paths for specific types
    if (context.type === 'function' && obj.name.startsWith('test_')) {
      return `tests/${obj.name}.xs`
    }
    // Return null to use default path from context
    return null
  },

  // Custom type resolver (optional)
  resolveType(inputPath, paths) {
    if (inputPath === "database") return ["table", "table_trigger"]
    return null  // Use default
  }
}
```

**Context object passed to custom functions:**

| Field | Description |
|-------|-------------|
| `type` | Object type (`function`, `table`, `api_endpoint`, etc.) |
| `naming` | Current naming mode (`default`, `vscode`, etc.) |
| `default` | Default result for the current naming mode |

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

File naming depends on the configured naming mode (see Naming Modes section).

**Default mode (`naming: "default"`):**

- Functions: `functions/{path}.xs` (natural text names become subdirectories)
- APIs: `apis/{group}.xs` and `apis/{group}/{path}_VERB.xs`
- Tables: `tables/{name}.xs`
- Triggers: `triggers/{table}/{name}.xs` (nested under table name)
- Tasks: `tasks/{name}.xs`

Natural text names with slashes become subdirectories:
- `User/Security Events/Log Auth` → `functions/user/security_events/log_auth.xs`

**VSCode mode (`naming: "vscode"`):**

- Functions: `functions/{name}.xs` (flat, no subdirectories)
- APIs: `apis/{group}/api_group.xs` and `apis/{group}/{path}_VERB.xs`
- Triggers: `triggers/{name}.xs` (flat, no table subdirectories)

**VSCode ID mode (`naming: "vscode_id"`):**

Same as `vscode` but with numeric ID prefixes:
- Functions: `functions/{id}_{name}.xs`
- Tables: `tables/{id}_{name}.xs`

## Agent Mode

The CLI supports an agent mode for AI assistants that provides structured, machine-readable output instead of human-friendly formatting.

### Auto-Detection

Agent mode is **automatically enabled** when the CLI detects it's running inside an AI coding assistant:

| Environment Variable | Agent Detected |
|---------------------|----------------|
| `CLAUDECODE=1` | Claude Code CLI/extension |
| `CURSOR_TRACE_ID` | Cursor IDE |
| `GITHUB_COPILOT_TOKEN` | GitHub Copilot |
| `AIDER_MODEL` | Aider AI assistant |
| `OPENCODE=1` | OpenCode terminal agent |

### Manual Control

```bash
# Force agent mode on
xano pull --agent
XANO_AGENT_MODE=1 xano pull

# Force agent mode off (even if auto-detected)
xano pull --agent=false
```

### Structured Output Format

In agent mode, the CLI outputs structured data with `AGENT_*` prefixes:

```
AGENT_WARNING: profile_not_configured
AGENT_MESSAGE: Multiple Xano profiles found but project has no profile configured.
AGENT_ACTION: Remind the user to configure a profile in xano.json for this project.
AGENT_CURRENT: production
AGENT_PROFILES:
- production (currently used) (default)
- staging
- development
AGENT_SUGGEST: Ask user which profile to use, then run: xano init --profile=<selected_profile>
```

**Output prefixes:**
| Prefix | Description |
|--------|-------------|
| `AGENT_STEP:` | Current step in multi-step process |
| `AGENT_PROMPT:` | Question or choice for the agent |
| `AGENT_OPTIONS:` | Available options (one per line with `-` prefix) |
| `AGENT_INPUT:` | Expected input type (`text`, `secret`) |
| `AGENT_NEXT:` | Suggested next command |
| `AGENT_COMPLETE:` | Operation completed successfully |
| `AGENT_RESULT:` | Key-value result data |
| `AGENT_WARNING:` | Warning type identifier |
| `AGENT_MESSAGE:` | Human-readable message for the agent to relay |
| `AGENT_ACTION:` | Instruction for what the agent should do |
| `AGENT_SUGGEST:` | Suggested action or command |

### Agent Mode for `init` Command

The `init` command has full agent mode support for non-interactive setup:

```bash
# Start initialization in agent mode
xano init --agent

# Provide credentials directly
xano init --agent --token="your-xano-token" --workspace=123 --branch=main

# The CLI will output AGENT_PROMPT for any missing information
```

## Environment Variables

- `XANO_PROFILE` - Default profile to use
- `XANO_BRANCH` - Default branch
- `XANO_AGENT_MODE` - Force agent mode (`1` or `true`)

## Troubleshooting

### "Not in a xano project"
Run `xano init` to initialize the project.

### "No profile found"
Run `xano init` to create credentials interactively, or use `xano init --token=<token>` for non-interactive setup.

### Push fails with validation error
Check the XanoScript syntax. Run `xano lint <file>` to validate.

### Files show as modified but unchanged
Run `xano pull --sync` to refresh the baseline.

### Missing objects.json
The CLI will auto-sync metadata when objects.json is missing. You can also run `xano pull --sync` manually.
