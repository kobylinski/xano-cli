# Xano CLI

Command-line interface for syncing XanoScript files between your local filesystem and Xano backend.

> **Note:** This is an unofficial fork of [@xano/cli](https://www.npmjs.com/package/@xano/cli) with additional features and improvements.

## Installation

```bash
npm install -g @deligopl/xano-cli
```

## Quick Start

```bash
# Create profile (one-time setup)
xano profile:wizard

# Initialize project in current directory
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
│   ├── config.json         # Branch info
│   └── objects.json        # Object mappings
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
# Show file status
xano status

# List remote objects
xano list
xano list app/functions/
xano list app/apis/auth
```

Status indicators:
- `M` - Modified locally
- `A` - New (local only)
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
xano branch v2           # Switch branch
```

## Data Commands

Work directly with table records. Password fields are automatically hashed.

```bash
# List/get records
xano data:list users
xano data:get users 1

# Create/update/delete
xano data:create users --data '{"email":"test@example.com"}'
xano data:update users 1 --data '{"name":"Updated"}'
xano data:delete users 1 --force

# Bulk insert
xano data:bulk users --file records.json

# Use specific data source (environment)
xano data:list users --datasource test
```

### Data Source Management

```bash
xano datasource:list
xano datasource:create staging
xano datasource:delete staging --force
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
xano profile:wizard          # Interactive setup
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
| `paths` | Local directory mappings for each object type |

**Path Configuration:**

All paths are relative to the project root. You can customize them to match your preferred structure:

```json
{
  "paths": {
    "functions": "src/functions",
    "apis": "src/api",
    "tables": "db/schema"
  }
}
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `XANO_PROFILE` | Default profile |
| `XANO_BRANCH` | Default branch |

## Claude Code Integration

Install the skill for AI-assisted development:

```bash
xano skill            # User scope
xano skill --project  # Project scope
```

## License

MIT
