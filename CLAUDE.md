# CLAUDE.md

Development guidelines for Claude Code when working on this project.

## Project Overview

Xano CLI - Command-line interface for the Xano Metadata API with project-based sync support.

### Project Structure

```
xano-cli/
├── bin/                    # CLI entry points
│   ├── dev.js              # Development runner (ts-node)
│   └── run.js              # Production runner (compiled)
├── src/
│   ├── commands/           # CLI commands (oclif structure)
│   │   ├── api/            # Live API commands (groups, endpoints, call)
│   │   ├── branch/         # Branch management
│   │   ├── data/           # Data manipulation (list, get, create, update, delete, bulk)
│   │   ├── function/       # Function CRUD operations
│   │   ├── init/           # Project initialization
│   │   ├── lint/           # XanoScript linting
│   │   ├── list/           # List remote objects
│   │   ├── profile/        # Profile management (wizard, create, edit, delete)
│   │   ├── pull/           # Pull files from Xano
│   │   ├── push/           # Push files to Xano
│   │   ├── skill/          # Claude Code skill installer
│   │   ├── static_host/    # Static hosting management
│   │   ├── status/         # Show file status
│   │   ├── sync/           # Sync state with Xano
│   │   └── workspace/      # Workspace operations
│   ├── lib/                # Shared library code
│   │   ├── api.ts          # Xano API client (XanoApi class)
│   │   ├── config.ts       # Configuration loader (xano.js/xano.json)
│   │   ├── detector.ts     # XanoScript type detection & path generation
│   │   ├── objects.ts      # Object file management
│   │   ├── project.ts      # Project configuration
│   │   ├── state.ts        # CLI state management
│   │   └── types.ts        # TypeScript type definitions
│   ├── help.ts             # Custom help formatter
│   └── index.ts            # Library exports
├── test/
│   ├── lib/                # Unit tests for library code
│   └── integration/        # Integration tests (requires live Xano)
├── .claude/
│   └── skills/xano-cli/    # Claude Code skill definition
├── xano.json               # Project config (versioned)
└── .xano/                  # Local state (gitignored)
```

### Technologies & Libraries

| Technology | Purpose |
|------------|---------|
| **TypeScript** | Primary language |
| **Node.js 18+** | Runtime environment |
| **oclif** | CLI framework (command structure, flags, args) |
| **Mocha + Chai** | Testing framework |
| **ESLint** | Code linting |
| **js-yaml** | YAML parsing for credentials |
| **xanoscript-lint** | XanoScript validation |

### Key Files

- `src/lib/api.ts` - Main API client with all Xano API methods
- `src/lib/config.ts` - Configuration loader supporting xano.js and xano.json
- `src/lib/detector.ts` - XanoScript type detection, path generation, sanitization
- `src/lib/types.ts` - TypeScript interfaces for all data structures
- `src/lib/project.ts` - Project initialization and configuration
- `package.json` - Dependencies and npm scripts

## Development Rules

### Before Any Development

1. **Verify Xano connection is available**
   ```bash
   xano profile:me
   ```
   This confirms the profile is set and credentials work.

2. **Ensure profile is configured**
   ```bash
   xano profile:list
   ```
   If no profiles exist, user must run `xano profile:wizard` first.

3. **For any tests involving live API calls**, user must explicitly choose the profile and workspace:
   ```bash
   export XANO_PROFILE=myprofile
   export XANO_TEST_WORKSPACE_ID=123
   export XANO_INTEGRATION_TEST=true
   ```

### Command Development

Commands follow oclif structure:
- One command per directory under `src/commands/`
- Each command exports a class extending `Command`
- Use `Args` and `Flags` from `@oclif/core`
- Commands should handle errors gracefully with `this.error()`

Example command structure:
```typescript
import { Args, Command, Flags } from '@oclif/core'

export default class MyCommand extends Command {
  static args = {
    name: Args.string({ description: '...', required: true }),
  }
  static description = 'Command description'
  static flags = {
    profile: Flags.string({ char: 'p', env: 'XANO_PROFILE' }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(MyCommand)
    // Implementation
  }
}
```

### API Client Usage

Always use the `XanoApi` class from `src/lib/api.ts`:
```typescript
import { getProfile, XanoApi } from '../lib/api.js'

const profile = getProfile(flags.profile)
if (!profile) {
  this.error('No profile found. Run "xano profile:wizard".')
}

const api = new XanoApi(profile, workspaceId, branch)
const response = await api.listFunctions()
```

### File Naming Convention

Files are named without ID prefixes, using sanitized names:

| Type | Path Pattern |
|------|--------------|
| Function | `{paths.functions}/{name}.xs` |
| Table | `{paths.tables}/{name}.xs` |
| Task | `{paths.tasks}/{name}.xs` |
| Workflow Test | `{paths.workflow_tests}/{name}.xs` |
| API Group | `{paths.apis}/{group}.xs` |
| API Endpoint | `{paths.apis}/{group}/{path}_{VERB}.xs` |
| Table Trigger | `{paths.triggers ?? paths.tables}/{table}/{name}.xs` |

Default sanitization converts names to `snake_case`:
- `calculateTotal` → `calculate_total`
- `/users/{id}` → `users_id`

### Configuration Files

The CLI supports two configuration formats:

**xano.json** - Static configuration (versioned):
```json
{
  "instance": "a1b2-c3d4",
  "workspaceId": 123,
  "workspace": "My Workspace",
  "paths": {
    "functions": "functions",
    "tables": "tables",
    "apis": "apis",
    "tasks": "tasks",
    "workflow_tests": "workflow_tests"
  }
}
```

**xano.js** - Dynamic configuration with custom resolvers:
```javascript
module.exports = {
  instance: 'a1b2-c3d4',
  workspaceId: 123,
  workspace: 'My Workspace',
  paths: {
    functions: 'src/functions',
    apis: 'src/apis'
  },

  // Optional: custom sanitize function
  sanitize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_')
  },

  // Optional: custom path resolver (return null to use default)
  resolvePath(obj, paths) {
    if (obj.type === 'function' && obj.name.startsWith('test_')) {
      return `tests/${obj.name}.xs`
    }
    return null // Use default resolution
  }
}
```

Priority: `xano.js` > `xano.json`

### Build & Run

```bash
# Development (with ts-node)
./bin/dev.js <command>

# Build
npm run build

# Production
./bin/run.js <command>
# or globally: xano <command>
```

## Testing

### Test Structure

```
test/
├── lib/                    # Unit tests (no network required)
│   ├── api-data.test.ts    # API client method tests
│   ├── detector.test.ts    # XanoScript detection tests
│   ├── objects.test.ts     # Object management tests
│   └── project.test.ts     # Project config tests
└── integration/            # Integration tests (requires live Xano)
    ├── setup.ts            # Test configuration and helpers
    ├── api.test.ts         # API integration tests
    └── commands.test.ts    # Command integration tests
```

### Running Tests

```bash
# Unit tests only (default, no network required)
npm test

# Integration tests (requires live Xano connection)
XANO_INTEGRATION_TEST=true \
XANO_TEST_WORKSPACE_ID=123 \
XANO_PROFILE=myprofile \
npm run test:integration

# All tests
npm run test:all
```

### Integration Test Requirements

Integration tests are disabled by default. To enable:

1. Set environment variables:
   - `XANO_INTEGRATION_TEST=true` - Enable integration tests
   - `XANO_TEST_WORKSPACE_ID` - Workspace ID to test against
   - `XANO_PROFILE` - Profile name with valid credentials
   - `XANO_TEST_BRANCH` - Branch name (default: "main")

2. Ensure profile has valid credentials:
   ```bash
   xano profile:me
   ```

Integration tests create temporary directories and clean up after themselves.

### Writing Tests

Unit tests should:
- Not require network access
- Use mock data where needed
- Test edge cases and error conditions

Integration tests should:
- Skip gracefully when not enabled
- Use `skipIfNoIntegration()` helper
- Clean up any created resources

## Git Repository Rules

### Commit Messages

1. **Brief description only** - Commit message should contain a short, clear description of what changed
   ```
   Add data manipulation commands
   Fix profile loading error
   Update API client for bulk operations
   ```

2. **Reference documentation** - If docs were created or used, include paths
   ```
   Add authentication flow documentation

   docs/auth-flow.md
   ```

3. **No signatures or marketing** - Do not include:
   - Generated by / Created with signatures
   - Co-authored-by AI attributions
   - Emoji decorations
   - Marketing links

### Branch Strategy

- `main` - Primary development branch
- Feature branches as needed for larger changes

### Before Committing

1. Build passes: `npm run build`
2. Tests pass: `npm test`
3. No unintended files staged
