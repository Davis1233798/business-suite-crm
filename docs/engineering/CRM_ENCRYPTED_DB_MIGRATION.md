# CRM Windows encrypted database migration contract

Status: design and driver acceptance only. No production migration or recovery
path is implemented by this document. The candidate Go driver added for the
Windows smoke test is not approved for production use pending the library
decision below.

## SQLCipher library decision gate

Do not ship `github.com/mutecomm/go-sqlcipher/v4 v4.4.2` as the product driver.
Its module release dates to December 2020; its bundled SQLite header reports
SQLite 3.33.0 and its bundled SQLCipher implementation is 4.4.2. The SQLCipher
maintainer states that this is not an official Go driver, is based on an
outdated SQLCipher version, uses a non-standard crypto provider, and did not
appear actively maintained at the time of that guidance. Current upstream
SQLCipher has stable 4.x releases through 4.20.0; 4.19.0 includes security fixes
for `sqlcipher_export` and hex-key URI handling, and 4.14.0 updates SQLite to
3.51.3 to fix a WAL-reset corruption bug. The upstream 5.0 beta is explicitly
not for production.

The Windows acceptance probe now evaluates `github.com/mattn/go-sqlite3`
v1.14.52 (upstream commit
`b0be46fa28d17ee0b65c79774ac0dad84b6db068`, MIT license) built with its
`libsqlite3` tag against official SQLCipher v4.20.0 source commit
`355d4db92d3404e71faa8088d071a71d767807f4` (SQLite 3.54.1, Zetetic BSD 3-Clause
license). Its upstream release build uses the OpenSSL provider, and the CI
script pins the source commit and checks the compiled SQLite and runtime cipher
versions.

Do not use mattn `ConnectHook` to set the key: the driver invokes that hook
after applying connection PRAGMAs, while SQLCipher requires keying before any
database operation. Instead, the probe uses SQLCipher's `hexkey` file-URI
parameter, consumed by `sqlite3_open` while opening each connection, before
those PRAGMAs. The mattn driver preserves `file:` URIs and requests URI support.
The Windows test checks the real engine version, encrypted file contents,
correct-key access on two simultaneously held pool connections, and rejection
of wrong and missing keys. It also holds a reader snapshot while committing a
new row, verifies the committed row is readable from the still-live encrypted
WAL through a fresh keyed pool, checks that fixture values are absent from the
WAL bytes, and reopens the database after close/checkpoint. The database key
exists only in the in-process URI string; production code must never log that
URI or include it in argv or the environment.

The CI build records the SQLCipher source commit, SQLite header version,
OpenSSL version, C compiler version, and SHA-256 of the built static library.

This is a driver proof, not production approval. Before migration code, review
the pinned SQLCipher/OpenSSL build, confirm its license notices and the final
packaged runtime dependencies, and maintain an explicit update process. No
normal SQLite fallback is acceptable: production startup must fail unless the
actual SQLCipher runtime reports the expected `cipher_version`. Windows
packaging must include the exact SQLCipher/OpenSSL runtime files or statically
link them and test the packaged application with no developer toolchain on
`PATH`.

Evidence: [mutecomm module publication metadata](https://pkg.go.dev/github.com/mutecomm/go-sqlcipher/v4),
[v4.4.2 bundled SQLite header](https://github.com/mutecomm/go-sqlcipher/blob/v4.4.2/sqlite3.h),
[SQLCipher maintainer guidance on Go bindings](https://discuss.zetetic.net/t/sqlcipher-is-supported-in-golang/5738),
[official SQLCipher releases](https://github.com/sqlcipher/sqlcipher/releases),
[official SQLCipher source/build documentation](https://github.com/sqlcipher/sqlcipher), and
[mattn/go-sqlite3 releases](https://github.com/mattn/go-sqlite3/releases).

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

The Windows export probe tests SQLCipher's `sqlcipher_export` with a keyed
destination as the main connection and the CRM source attached read-only
with an empty key. It uses the actual CRM schema and a committed WAL record.
The probe checks that the original database and WAL bytes are unchanged
and that the keyed copy reopens with the business and identity tables.
Source lock orchestration, full content verification and publication remain
part of the migration sequence below.


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

## Key, identity, and portable recovery contract

The offline device password gates local use; it is not the SQLCipher key and
must not be reused as the recovery secret. DPAPI-wrapped key storage is for
normal same-Windows-user operation only. A portable encrypted backup must also
include a versioned AES-256-GCM envelope of the random database key, wrapped
with a separately enrolled owner recovery secret. The recovery secret must be
independent of the Windows profile and device password; a passphrase-based
enrollment must use a reviewed, parameter-versioned password KDF and unique
salt. The secret must never be stored beside the backup or sent to a service.
Enrollment must verify a test unwrap before declaring recovery ready.

Fresh-device restore must decrypt the envelope using the owner's recovery
secret, verify the SQLCipher database, then wrap the database key with the new
device's Windows DPAPI for normal operation. Keep the original Windows DPAPI
path as a convenience, not the only recovery contract. The recovery UI and
documentation must explain how the owner protects and supplies this secret.

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
  wrong key, and is readable using the documented recovery procedure from a
  fresh Windows user/profile that does not have the original DPAPI material.
- Portable backup envelope unwrap succeeds with the enrolled owner recovery
  secret and fails with an incorrect secret or modified envelope; the restored
  database key is rewrapped under the new Windows user's DPAPI. Recovery must
  be verified before enrollment is marked complete.
- Windows `safeStorage` unavailable, Linux/macOS, and test mocks cannot fall
  back to plaintext key storage or plaintext destination creation.
- The database key appears in no process arguments, environment, logs, crash
  output, or temporary files. Session-secret checks remain independently
  asserted and are not confused with database-key transport.

Until those tests pass in Windows CI and on the packaged desktop lifecycle,
status remains design-only; no migration-complete or recovery-complete claim is
valid.
