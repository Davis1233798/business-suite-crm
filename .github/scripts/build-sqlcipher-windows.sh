#!/usr/bin/env bash
set -euo pipefail

workspace="$(cygpath -u "$GITHUB_WORKSPACE")"
root="$workspace/.sqlcipher-windows"
source="$root/source"
expected_commit="355d4db92d3404e71faa8088d071a71d767807f4"

mkdir -p "$root"
git clone --depth 1 --branch v4.20.0 https://github.com/sqlcipher/sqlcipher.git "$source"
actual_commit="$(git -C "$source" rev-parse HEAD)"
if [[ "$actual_commit" != "$expected_commit" ]]; then
  echo "SQLCipher source pin mismatch" >&2
  exit 1
fi

cd "$source"
export CC=gcc
export AR=ar
export RANLIB=ranlib
./configure \
  --with-tempstore=yes \
  CFLAGS="-DSQLITE_HAS_CODEC -DSQLITE_EXTRA_INIT=sqlcipher_extra_init -DSQLITE_EXTRA_SHUTDOWN=sqlcipher_extra_shutdown -DSQLITE_THREADSAFE=1 -DSQLCIPHER_CRYPTO_OPENSSL" \
  LDFLAGS="-lcrypto"
make -j2 libsqlite3.a sqlite3.h
test -f libsqlite3.a
test -f sqlite3.h

printf 'SQLCipher commit: %s\n' "$actual_commit"
printf 'SQLite header: %s\n' "$(grep -m1 '#define SQLITE_VERSION ' sqlite3.h)"
printf 'SQLCipher provider define: %s\n' "$(grep -m1 'SQLCIPHER_CRYPTO_OPENSSL' config.log || true)"
printf 'OpenSSL build provider: %s\n' "$(openssl version)"
printf 'Windows C compiler: %s\n' "$(gcc --version | head -n1)"
printf 'SQLCipher static library SHA-256: %s\n' "$(sha256sum libsqlite3.a | cut -d ' ' -f 1)"
