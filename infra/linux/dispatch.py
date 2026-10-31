"""Called by a Linux timer; credentials come from its protected EnvironmentFile."""
import json
import os
import urllib.request
from urllib.parse import urlsplit

origin = os.environ['MAIN_URL'].rstrip('/')
if urlsplit(origin).scheme != 'https':
    raise ValueError('MAIN_URL must use HTTPS')
request = urllib.request.Request(origin + '/api/platform/dispatch', method='POST', headers={'Authorization': 'Bearer ' + os.environ['INFRA_GATEWAY_TOKEN']})
with urllib.request.urlopen(request, timeout=120) as response:
    result = json.load(response)
    print('Commerce dispatch:', result.get('sent', 0), 'events')
