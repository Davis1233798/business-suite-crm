"""Exercise production Caddy routes privately, without TLS issuance or public ports."""
import http.client
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import uuid

release = Path(sys.argv[1]).resolve()
source = (release / 'infra/linux/Caddyfile.sites').read_text()
lines = source.splitlines()
for i, line in enumerate(lines):
    if line.endswith(' {') and '{$BASE_DOMAIN}' in line:
        lines[i] = 'http://' + line
temporary = tempfile.NamedTemporaryFile(mode='w', suffix='.caddy', delete=False)
temporary.write('\n'.join(lines) + '\n')
temporary.close()
name = 'suite-edge-check-' + uuid.uuid4().hex[:12]
created = False
try:
    subprocess.run(['docker','run','--rm','-d','--name',name,'--network','business-suite_default',
                    '-p','127.0.0.1::80','-e','BASE_DOMAIN=blockchen.duckdns.org',
                    '--mount',f'type=bind,src={temporary.name},dst=/etc/caddy/Caddyfile,readonly',
                    'caddy:2.10-alpine'], check=True, capture_output=True, text=True)
    created = True
    address = subprocess.check_output(['docker','port',name,'80/tcp'],text=True).strip()
    port = int(address.rsplit(':',1)[1])

    def request(host, path):
        connection = http.client.HTTPConnection('127.0.0.1',port,timeout=10)
        try:
            connection.request('GET',path,headers={'Host':host})
            response = connection.getresponse()
            result = (response.status,dict(response.getheaders()),response.read())
            return result
        finally:
            connection.close()

    for attempt in range(30):
        try:
            request('blockchen.duckdns.org','/api/health')
            break
        except (OSError,http.client.HTTPException):
            time.sleep(.2)
    for station in ('','mes','erp','pos','crm','dining','shop','commerce'):
        host = (station+'.' if station else '')+'blockchen.duckdns.org'
        status,headers,body = request(host,'/')
        assert status == (302 if station else 200),(host,status)
        if station:
            assert headers.get('Location')=='/'+station,(host,headers)
        status,_,body = request(host,'/api/health')
        assert status==200 and json.loads(body)['success'],(host,status)
        assert request(host,'/api/platform/dispatch')[0]==404,host
        assert request(host,'/api/platform/control/status')[0]==401,host
        print('PASS:',host,'landing, backend health, dispatch denial and operator authentication')
finally:
    if created:
        subprocess.run(['docker','stop',name],check=True,capture_output=True)
    Path(temporary.name).unlink()
