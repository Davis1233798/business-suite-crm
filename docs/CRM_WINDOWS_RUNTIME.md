# CRM Windows desktop runtime contract

The Windows launcher owns the local Go process, DPAPI key storage and browser
window lifetime. It provides the asset path through SUITE_WEB and requests an
ephemeral loopback listener through SUITE_ADDR. The Go process announces the
actual bound address on stdout after opening the database and binding the
listener. Startup diagnostics stay on stderr.

Desktop mode requires a 256-bit key from stdin and the packaged SQLCipher
engine. Validate the engine and key before creating schema or serving HTTP.
An existing plaintext database requires a separately verified migration.
The web deployment continues to use its current SQLite driver.

Local acceptance exercises the packaged launcher with an isolated profile,
checks startup and shutdown, and verifies that the created database requires
the expected key. The existing SQLCipher WAL export tests cover the migration
primitive.
