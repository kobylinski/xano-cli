# Agent Detection

This document describes how xano-cli detects when it's being run by an AI agent and adapts its behavior accordingly.

## Overview

The CLI can operate in three modes:
1. **Interactive Mode** - Human user at terminal, prompts and wizards
2. **Non-Interactive Mode** - Script automation, relies on flags/config only
3. **Agent Mode** - AI agent (Claude, Copilot, etc.), progressive discovery with structured output

Agent mode is automatically detected from environment variables or explicitly enabled via `--agent` flag.

## Implementation

### Source File

`src/base-command.ts`

### Key Functions

#### `detectAgentEnvironment(): string | null`

Detects known AI agent environments by checking environment variables.

```typescript
export function detectAgentEnvironment(): null | string {
  // Explicit agent mode (highest priority)
  if (process.env.XANO_AGENT_MODE === '1') return 'xano-agent'

  // Claude Code (CLI or extension)
  if (process.env.CLAUDECODE === '1') return 'claude-code'

  // Cursor IDE
  if (process.env.CURSOR_TRACE_ID) return 'cursor'

  // GitHub Copilot CLI
  if (process.env.GITHUB_COPILOT_TOKEN || process.env.COPILOT_AGENT_ENABLED === '1') return 'github-copilot'

  // Aider AI coding assistant
  if (process.env.AIDER_MODEL || process.env.AIDER_CHAT_HISTORY_FILE) return 'aider'

  // OpenCode AI terminal agent
  if (process.env.OPENCODE === '1') return 'opencode'

  return null
}
```

**Returns:** Agent identifier string or `null` if no agent detected.

| Agent | Environment Variable | Return Value |
|-------|---------------------|--------------|
| Explicit | `XANO_AGENT_MODE=1` | `'xano-agent'` |
| Claude Code | `CLAUDECODE=1` | `'claude-code'` |
| Cursor | `CURSOR_TRACE_ID` (any value) | `'cursor'` |
| GitHub Copilot | `GITHUB_COPILOT_TOKEN` or `COPILOT_AGENT_ENABLED=1` | `'github-copilot'` |
| Aider | `AIDER_MODEL` or `AIDER_CHAT_HISTORY_FILE` | `'aider'` |
| OpenCode | `OPENCODE=1` | `'opencode'` |

#### `isAgentMode(flagValue?: boolean): boolean`

Determines if agent mode is active, considering both flag and auto-detection.

```typescript
export function isAgentMode(flagValue?: boolean): boolean {
  // Explicit flag always wins
  if (flagValue === true) return true
  if (flagValue === false && process.env.XANO_AGENT_MODE !== '1') return false

  // Auto-detect from environment
  return detectAgentEnvironment() !== null
}
```

**Priority:**
1. `--agent` flag (explicit true/false)
2. `XANO_AGENT_MODE` environment variable
3. Auto-detection from known agent environments

## Base Command Integration

All commands extend `BaseCommand` which provides the `--agent` flag:

```typescript
export default abstract class BaseCommand extends Command {
  static baseFlags = {
    agent: Flags.boolean({
      default: false,
      description: 'Agent mode (non-interactive, machine-readable output)',
      env: 'XANO_AGENT_MODE',
      hidden: true,  // Not shown in help by default
    }),
    // ... other flags
  }
}
```

## Usage in Commands

Commands check agent mode and adapt their output:

```typescript
import BaseCommand, { isAgentMode } from '../../base-command.js'

export default class MyCommand extends BaseCommand {
  async run(): Promise<void> {
    const { flags } = await this.parse(MyCommand)
    const agentMode = isAgentMode(flags.agent)

    if (agentMode) {
      // Output structured data for agent consumption
      console.log(JSON.stringify({ status: 'success', data: result }))
    } else {
      // Human-readable output
      this.log('Operation completed successfully')
    }
  }
}
```

## Commands Using Agent Detection

The following commands implement agent-aware behavior:

| Command | File | Usage |
|---------|------|-------|
| `init` | `src/commands/init/index.ts` | Full agent flow with progressive discovery |
| `pull` | `src/commands/pull/index.ts` | Profile warning suppression |
| `push` | `src/commands/push/index.ts` | Profile warning suppression |
| `sync` | `src/commands/sync/index.ts` | Profile warning suppression |
| `status` | `src/commands/status/index.ts` | Machine-readable status output |
| `list` | `src/commands/list/index.ts` | Structured list output |
| `explain` | `src/commands/explain/index.ts` | AI-optimized explanations |
| `api:call` | `src/commands/api/call/index.ts` | JSON response handling |
| `data:*` | `src/commands/data/*/index.ts` | Bulk operation feedback |

## Agent Output Format

When in agent mode, commands output markdown for better AI agent consumption:

### Selection Required

```markdown
# Selection Required

## Step: workspace

Select workspace

## Options

| Label | Value | Default |
|-------|-------|---------|
| My Workspace | 123 | ✓ |
| Other Workspace | 456 | |

## Next Step

After user selects, run:

\`\`\`bash
xano init --workspace=<selected_value>
\`\`\`
```

### Input Required

```markdown
# Input Required

## Step: token

Enter your Xano access token

**Type:** secret (do not echo)

## Next Step

After user provides input, run:

\`\`\`bash
xano init --access-token=<user_input>
\`\`\`
```

### Complete

```markdown
# Initialization Complete

## Configuration

| Setting | Value |
|---------|-------|
| Profile | my-profile |
| Workspace | My Workspace (123) |
| Branch | v1 |

## Files Created

- xano.json
- .xano/config.json
- .xano/datasources.json

## Next Step

\`\`\`bash
xano pull
\`\`\`
```

### Error

```markdown
# Error: MISSING_WORKSPACE

Workspace ID is required

## Current State

| Setting | Value |
|---------|-------|
| Profile | my-profile |

## Resolution

Provide --workspace flag with workspace ID or name:

\`\`\`bash
xano init --profile=my-profile --workspace=<id_or_name>
\`\`\`
```

## Adding New Agent Detection

To add detection for a new AI agent:

1. Identify the environment variable(s) the agent sets
2. Add detection in `detectAgentEnvironment()`:

```typescript
// New AI Agent
if (process.env.NEW_AGENT_VAR) {
  return 'new-agent'
}
```

3. Update this documentation with the new agent

## Testing Agent Mode

```bash
# Explicit flag
xano init --agent

# Environment variable
XANO_AGENT_MODE=1 xano init

# Simulate Claude Code
CLAUDECODE=1 xano init

# Simulate Cursor
CURSOR_TRACE_ID=test xano init
```
