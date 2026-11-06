# CRM Windows encrypted database migration contract

Status: design and driver acceptance only. No production migration or recovery
path is implemented by this document.

## Scope and source boundary

The source is the CRM Go desktop database opened by `backend.openDB`, using
`modernc.org/sqlite` and the schema/migrations embedded by `backend/main.go`.
This is distinct from the Vinext SQLite snapshot converter. The source must be
opened read-only after all desktop writers have stopped. SQLite must produce a
consistent snapshot while accounting for `-wal` and `-shm`; copying the main
file alone is not a valid snapshot procedure.

The destination is a new SQLCipher database at a new path. An existing target,
key file, or target sidecar must cause a hard failure without replacement. The
plaintext source and its sidecars remain untouched until an operator verifies
the encrypted destination and recovery copy. There is no automatic deletion.

## Required migration sequence

1. Acquire an exclusive per-user migration lock and stop/confirm stopped all
   processes that can write the source.
2. Verify the source is a regular CRM database, run SQLite integrity and
   foreign-key checks, and capture a transactionally consistent snapshot that
   includes committed WAL content.
3. Create a new destination and new random 256-bit database key. Wrap the key
   with Windows Electron `safeStorage` (DPAPI); fail closed if safeStorage is
   unavailable. Never persist or log the plaintext key.
4. Open SQLCipher with the key supplied only through an inherited private pipe
   (not argv, environment, logs, or a temporary plaintext key file). Copy the
   complete schema and rows, preserving CRM records, account identities,
   grants, sessions, and audit history. Run integrity, foreign-key, schema,
   row-count, and deterministic content checks before marking migration done.
5. Close and reopen the destination using the wrapped key. Verify the file is
   recognized as encrypted and that an absent/wrong key cannot read the schema.
6. Create an encrypted recovery backup and verify it by restoring to a second
   fresh path, reopening with the same recovered key, and comparing integrity
   and content. Backup format must carry the encrypted DB and wrapped key plus
   documented Windows-account recovery constraints; it must never silently
   become a plaintext export.
7. Atomically publish a completion marker and switch the desktop to the
   destination. Keep the source and independent backup until explicit
   acceptance. On any earlier error, close handles and remove only newly
   created destination artifacts; retain source and preexisting files.

## Key, identity, and recovery contract

The offline device password gates local use; it is not the SQLCipher key and
does not authorize a new device or recover a lost DPAPI key. Do not represent
copied database files as portable. Recovery must be explicit: either restore
under the original Windows user/DPAPI context or define and test a separately
protected recovery-key enrollment flow before claiming cross-device recovery.
Until that exists, document that loss of the Windows profile/DPAPI material can
make both the live database and its DPAPI-wrapped key unrecoverable.

`SUITE_DESKTOP_SECRET` is the HTTP desktop-session secret. It is not the
database key. The database key must never be placed in an environment variable.
Same-user processes may have broad access to process resources; the UI lock is
not a security boundary against malware or administrators running as that user.

## Windows CI acceptance tests required before production migration

Tests must use the actual packaged Go SQLCipher driver and run on Windows with
CGO enabled. A driver-only smoke test is necessary but is not sufficient. The
production migration API must be exercised end to end with a populated CRM
source containing representative business rows, identities/grants, and audit
records. Required assertions:

- SQLCipher database is detected as encrypted; its bytes are not a readable
  plaintext SQLite database; correct key succeeds and wrong/missing key fails.
- Migration preserves schema, every row, foreign keys, identities/grants, and
  audit history; source bytes and source WAL/SHM remain unchanged.
- A live WAL transaction is included in the snapshot after a clean writer
  shutdown; uncommitted data is not included.
- Existing destination/key/sidecars are never overwritten. Failure injection
  at snapshot, copy, validation, key wrapping, and finalization leaves source
  usable and permits a clean retry.
- Encrypted backup restore into a fresh path preserves content, rejects a
  wrong key, and is readable using the documented recovery procedure.
- Windows `safeStorage` unavailable, Linux/macOS, and test mocks cannot fall
  back to plaintext key storage or plaintext destination creation.
- The database key appears in no process arguments, environment, logs, crash
  output, or temporary files. Session-secret checks remain independently
  asserted and are not confused with database-key transport.

Until those tests pass in Windows CI and on the packaged desktop lifecycle,
status remains design-only; no migration-complete or recovery-complete claim is
valid.
