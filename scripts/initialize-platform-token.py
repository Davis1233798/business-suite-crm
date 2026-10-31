"""Add a dedicated operator credential without replacing existing service secrets."""
import os
from pathlib import Path
import secrets
import sys
import tempfile

target = Path(sys.argv[1]).resolve(strict=True)
source = target.read_text()
values = dict(line.split('=',1) for line in source.splitlines() if '=' in line and not line.startswith('#'))
token = values.get('PLATFORM_TOKEN','')
if token:
    if len(token) < 32 or token == values.get('GATEWAY_TOKEN'):
        raise SystemExit('Existing operator credential must be distinct and at least 32 characters')
    os.chmod(target,0o600)
    print('Dedicated operator credential already configured')
else:
    lines = [line for line in source.splitlines() if not line.startswith('PLATFORM_TOKEN=')]
    lines.append('PLATFORM_TOKEN='+secrets.token_hex(32))
    fd, temporary = tempfile.mkstemp(dir=target.parent,prefix='.operator-')
    try:
        with os.fdopen(fd,'w') as file:
            file.write('\n'.join(lines)+'\n')
        os.chmod(temporary,0o600)
        os.replace(temporary,target)
    finally:
        if Path(temporary).exists(): Path(temporary).unlink()
    print('Dedicated operator credential initialized; value not printed')
