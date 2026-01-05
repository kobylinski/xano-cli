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

# Sync with Xano and pull all files
xano sync --pull
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
│   ├── objects.json        # Object ID mappings (VSCode compatible)
│   └── state.json          # CLI state (etag, keys)
├── functions/              # XanoScript functions
├── apis/                   # API endpoints by group
│   ├── auth/
│   └── user/
├── tables/                 # Table definitions
└── tasks/                  # Scheduled tasks
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

### Sync

```bash
# Fetch object mappings from Xano (updates .xano/ files)
xano sync

# Also pull all files locally
xano sync --pull

# Pull and delete local files not on Xano
xano sync --pull --clean
```

### Status

```bash
# Show local changes vs Xano
xano status

# Output as JSON
xano status --json
```

Output shows:
- `M` - Modified locally
- `A` - New (not on Xano)
- `D` - Deleted locally
- `?` - Orphan (on Xano, no local file)

### List Remote Objects

```bash
# List all objects on Xano
xano list

# List by type (shell autocomplete works!)
xano list functions/
xano list tables/
xano list apis/
xano list tasks/

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

### Push

```bash
# Push specific files
xano push functions/my_function.xs
xano push apis/auth/endpoint.xs

# Push git-staged .xs files
xano push --staged

# Push all modified/new files
xano push --all

# Dry run (show what would be pushed)
xano push --dry-run

# Force push (skip conflict check)
xano push --force
```

### Pull

```bash
# Pull specific files
xano pull functions/my_function.xs

# Pull all files
xano pull --all

# Attempt 3-way merge with local changes
xano pull --merge functions/my_function.xs

# Force overwrite local changes
xano pull --force

# Dry run
xano pull --dry-run
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

### Ephemeral Jobs

Run XanoScript without creating permanent resources:

```bash
xano ephemeral:run:job -f script.xs
xano ephemeral:run:job -f script.xs -a args.json
xano ephemeral:run:service -f service.xs
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
# Start of day - check what changed
xano status

# Pull any server changes
xano pull --all

# Work on files locally...

# Push changes
xano push functions/my_function.xs

# Or push all modified
xano push --all
```

### Git Integration

```bash
# Stage and push together
git add functions/new_feature.xs
xano push --staged
git commit -m "Add new feature"
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

# Re-sync mappings for new branch
xano sync

# Pull files from new branch
xano sync --pull
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
    "tasks": "tasks"
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
