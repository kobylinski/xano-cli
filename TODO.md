# Xano CLI - Unimplemented API Features

Features from the Xano Metadata API not yet implemented in the CLI.

> **Note:** Branch creation is NOT available via Metadata API (tested Jan 2026).
> Only list and delete are supported. Branches must be created via Xano UI.

## Workspace Management

- [ ] **Delete branch** - DELETE workspace branch (cannot delete default or live)
- [ ] Export workspace archive - Export complete workspace data/config
- [ ] Export database schema - Export schemas and branch config as file
- [ ] Import database schema - Import into new branch with optional deployment
- [ ] Replace workspace - Replace content with imported archive
- [ ] **File management** - Upload, list, delete workspace files

## API Groups & Endpoints

- [x] **Create API group** - POST new API group (implemented Jan 2026)
- [ ] Update API group - Modify name, description, docs, tags
- [ ] Delete API group - DELETE group and all endpoints
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
- [ ] **Truncate table** - Delete all records, optionally reset PK

## Table Content (Bulk Operations)

- [ ] **Bulk update** - Update multiple records in single operation
- [ ] **Update by criteria** - Update all records matching search
- [ ] **Bulk delete by IDs** - Delete multiple records by ID array
- [ ] **Delete by criteria** - Delete all records matching search

## Functions

- [ ] Update function security - Configure access controls
- [ ] Search function history - Advanced filters and sorting

## Tasks

- [ ] Update task security - Configure access controls
- [ ] Search task history - Advanced filters and sorting

## Real-time

- [ ] Get real-time metrics - Connection details and operational metrics
- [ ] Update real-time settings - Configure connection settings

## Audit & History

- [ ] Browse audit logs (all workspaces) - Cross-workspace audit
- [ ] Search audit logs (all workspaces) - Complex filtering/sorting
- [ ] Workspace audit logs - Browse with pagination
- [ ] Search workspace audit logs - Advanced filters
- [ ] **Search API history** - Advanced filters (currently list only)
- [ ] Middleware history - Browse and search
- [ ] Tool history - Browse and search
- [ ] Trigger history - Browse and search

---

## Priority Features

High-value features to implement first:

1. ~~**Branch deletion**~~ - Waiting for branch creation API
2. ~~**Create API group**~~ - ✓ Done (Jan 2026)
3. **Bulk data operations** - bulk update, delete by criteria
4. **Truncate table** - Reset table data
5. **Search history** - Filter and search request history
6. **File management** - Static hosting file operations
