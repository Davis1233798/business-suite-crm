# CRM Windows desktop identity and data boundary

## Architecture

The Windows desktop package has its own Electron application identity (`org.blockchen.relationdesk.crm`) and display name (`RelationDesk CRM`). At startup, Electron resolves a CRM-only directory beneath the Windows per-user application-data root and sets it as `userData` before creating or reading profile state. The bundled Go backend receives a CRM-only SQLite file inside that directory. The installer and runtime do not inspect or migrate any other application data.

Windows CI validates the identity/path contract, prepares the CRM web assets and Go backend, packages an unpacked Windows desktop app, and uploads the package as a short-lived artifact.

## Boundaries

- Profile directory: `%APPDATA%\RelationDesk CRM`.
- Database file: `%APPDATA%\RelationDesk CRM\crm-repository.sqlite`.
- No legacy Business Suite, MES, ERP, POS, dining, or commerce database is opened, copied, migrated, renamed, or deleted.
- Existing files under the new CRM-specific directory are left to the CRM backend's existing repository marker checks.
- This change does not add encryption, backup, restore, signing, or a user-data migration.

## Acceptance checks

- Automated identity tests assert the appId, product name, absolute app-data root requirement, CRM-only path, and separation from the former shared-suite path.
- The Windows workflow runs those checks before preparing and packaging the app; it uploads only the unpacked CRM desktop artifact.
- Local tests are intentionally not run for this change; the GitHub Actions result is the Windows build evidence.
