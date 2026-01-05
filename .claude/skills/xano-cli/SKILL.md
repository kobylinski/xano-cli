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
├── xano.json              # Project config (versioned)
├── .xano/
│   ├── config.json        # Local config with branch info
│   ├── objects.json       # Object mappings and checksums
│   └── state.json         # Sync state and etags
├── functions/             # XanoScript functions
├── apis/                  # API endpoints by group
│   ├── GroupName/
│   │   └── 123_POST_endpoint.xs
├── tables/                # Table definitions
└── tasks/                 # Scheduled tasks
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

### Sync with Xano

```bash
# Update mappings only (no file changes)
xano sync

# Pull all files from Xano
xano sync --pull

# Pull and remove local files not on Xano
xano sync --pull --clean
```

### Check Status

```bash
# Show modified, new, and deleted files
xano status
```

Status indicators:
- `M` - Modified locally
- `D` - Deleted locally (exists on Xano)
- `N` - New (not yet on Xano)

### Push Changes

```bash
# Push specific file
xano push functions/my_function.xs

# Push multiple files
xano push functions/*.xs

# Push all modified files
xano push --all
```

### Pull Changes

```bash
# Pull specific file
xano pull functions/my_function.xs

# Pull with force (overwrite local changes)
xano pull --force functions/my_function.xs

# Pull all files
xano pull --all

# Attempt 3-way merge
xano pull --merge functions/my_function.xs
```

### List Objects

```bash
# List all functions
xano list functions

# List API endpoints
xano list apis

# List tables
xano list tables

# List tasks
xano list tasks
```

### Branch Management

```bash
# List branches
xano branch

# Switch branch
xano branch --switch live
```

## Workflow Examples

### Daily Development Workflow

1. Start by syncing to get latest changes:
   ```bash
   xano sync --pull
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

1. Sync to ensure you have latest:
   ```bash
   xano sync --pull
   ```

2. Create new XanoScript file locally

3. Push to create on Xano:
   ```bash
   xano push functions/new_feature.xs
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

## Tips

1. **Always sync before starting work** to avoid conflicts

2. **Use `xano status` frequently** to see what's changed

3. **Push small, focused changes** rather than large batches

4. **Keep .xano/ in .gitignore** - it contains local state

5. **Commit xano.json to git** - it defines the project

## File Naming Convention

Files are named with their Xano ID prefix for reliable mapping:

- Functions: `{id}_{Name}.xs`
- APIs: `{id}_{VERB}_{path}.xs`
- Tables: `{id}_{name}.xs`
- Tasks: `{id}_{name}.xs`

## Environment Variables

- `XANO_PROFILE` - Default profile to use
- `XANO_BRANCH` - Default branch

## Troubleshooting

### "Not in a xano project"
Run `xano init` to initialize the project.

### "No profile found"
Run `xano profile:wizard` to create credentials.

### Push fails with validation error
Check the XanoScript syntax. Run `xano lint <file>` if available.

### Files show as modified but unchanged
Run `xano sync --pull` to refresh the baseline.
