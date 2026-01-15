# Xano CLI - Unimplemented API Features

Features from the Xano Metadata API not yet implemented in the CLI.

> **Note:** Branch creation is NOT available via Metadata API (tested Jan 2026).
> Only list and delete are supported. Branches must be created via Xano UI.

## Workspace Management

- [~] ~~**Delete branch**~~ - Not implementing (branch creation not available via API)
- [ ] Export workspace archive - Export complete workspace data/config
- [ ] Export database schema - Export schemas and branch config as file
- [ ] Import database schema - Import into new branch with optional deployment
- [ ] Replace workspace - Replace content with imported archive
- [ ] **File management** - Upload, list, delete workspace files

## API Groups & Endpoints

- [x] **Create API group** - POST new API group ✓
- [x] **Update API group** - Modify via XanoScript push ✓
- [x] **Delete API group** - DELETE group and all endpoints ✓
- [ ] Get OpenAPI spec - GET Swagger JSON for group or endpoint
- [ ] Update API group security - Configure access permissions
- [ ] Update endpoint security - Configure endpoint access controls

## Tables & Schema

- [ ] Get table schema via API - GET complete schema definition
- [ ] Replace table schema - PUT entire schema definition
- [ ] Rename column - Rename column in schema
- [ ] Delete column - Remove column from schema
- [ ] Get indexes - Retrieve all table indexes
- [ ] Replace indexes - Replace all indexes with new config
- [ ] Delete index - Remove specific index
- [x] **Truncate table** - `data:truncate` command (deletes records iteratively) ✓

## Table Content (Data Operations)

- [x] **List/search records** - `data:list` with filters, sort, pagination ✓
- [x] **Export data** - `data:export` to JSON/CSV, batch export with --tags/--tables ✓
- [x] **Import data** - `data:import` with upsert/insert/update modes, chunking ✓
- [x] **Bulk insert** - `data:bulk` command ✓
- [x] **Bulk update** - `data:update --filter/--ids` with iterative API calls ✓
- [x] **Update by criteria** - `data:update --filter` ✓
- [x] **Bulk delete by IDs** - `data:delete --ids` ✓
- [x] **Delete by criteria** - `data:delete --filter` ✓

## Functions

- [ ] Update function security - Configure access controls
- [x] Function history - `history` command supports function runs ✓

## Tasks

- [ ] Update task security - Configure access controls
- [x] Task history - `history` command supports task runs ✓

## Real-time

- [ ] Get real-time metrics - Connection details and operational metrics
- [ ] Update real-time settings - Configure connection settings

## Audit & History

- [ ] Browse audit logs (all workspaces) - Cross-workspace audit
- [ ] Search audit logs (all workspaces) - Complex filtering/sorting
- [ ] Workspace audit logs - Browse with pagination
- [ ] Search workspace audit logs - Advanced filters
- [x] **API request history** - `xano history` with filters, `history:get` for details ✓
- [x] **Middleware history** - Supported via history command ✓
- [ ] Tool history - Browse and search
- [x] **Trigger history** - Supported via history command ✓

---

## Implementation Summary

### ✓ Completed Features

| Feature | Command | Notes |
|---------|---------|-------|
| Create API group | `push` | Auto-creates from XanoScript |
| Update API group | `push` | Updates via XanoScript |
| Delete API group | `push --clean` | Deletes when file removed |
| Truncate table | `data:truncate` | Iterative deletion |
| Data export | `data:export` | JSON/CSV, batch with --tags/--tables |
| Data import | `data:import` | upsert/insert/update modes |
| Bulk insert | `data:bulk` | With chunking support |
| Bulk update | `data:update --filter/--ids` | Filter or ID-based bulk update |
| Bulk delete | `data:delete --filter/--ids` | Filter or ID-based bulk delete |
| Request history | `history` | Browse and filter |
| History details | `history:get` | View full request/response |

### Priority Features Remaining

1. **File management** - Static hosting file upload/list/delete
2. **OpenAPI spec** - Export Swagger documentation
3. **Schema operations** - Column rename/delete, index management
4. **Security config** - API group and endpoint access controls

### Not Implementing

- **Branch deletion** - Limited branch management via API (no creation), implementing only deletion has no practical value
