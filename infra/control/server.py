import json
import logging
import logging.handlers
import os
from pathlib import Path
import secrets
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from .engine import DockerEngine
from .plane import ControlPlane, ControlError

token = os.environ['PLATFORM_TOKEN']
if len(token) < 32: raise RuntimeError('Set a dedicated operator token with at least 32 characters')
graph = json.loads(Path('/srv/control/services.json').read_text())
registry = json.loads(Path('/srv/sites.json').read_text())
audit = logging.getLogger('control.audit')
audit.setLevel(logging.INFO)
handler = logging.handlers.RotatingFileHandler('/data/audit.jsonl',maxBytes=1024*1024,backupCount=3)
audit.addHandler(handler)
plane = ControlPlane(DockerEngine(os.environ.get('COMPOSE_PROJECT_NAME','business-suite'),graph),graph,{site['id']:site['services'] for site in registry['sites']},audit=lambda event:audit.info(json.dumps({'time':time.time(),**event})))

class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def dispatch(self):
        if self.command == 'GET' and self.path == '/health': return self.respond(200,{'status':'ready'})
        if not secrets.compare_digest(self.headers.get('Authorization','').encode(),('Bearer '+token).encode()): return self.respond(401,{'error':'Operator authentication required'})
        try:
            if self.command == 'GET' and self.path == '/status': return self.respond(200,plane.status())
            if self.command != 'POST' or self.path not in ('/plan','/apply'): return self.respond(404,{'error':'Unknown operation'})
            length = int(self.headers.get('Content-Length','0'))
            if not 0 < length <= 16384: return self.respond(413,{'error':'Invalid request size'})
            body = json.loads(self.rfile.read(length))
            if not isinstance(body,dict): raise ControlError('Expected an object')
            if self.path == '/plan':
                if set(body) != {'site','service','action'} or any(not isinstance(value,str) for value in body.values()): raise ControlError('Invalid plan fields')
                result = plane.plan(body['site'],body['service'],body['action'])
            else:
                if set(body) != {'plan_id'} or not isinstance(body['plan_id'],str): raise ControlError('Invalid plan identity')
                result = plane.apply(body['plan_id'])
            self.respond(200,result)
        except ControlError as error: self.respond(error.status,{'error':str(error)})
        except (ValueError,TypeError): self.respond(400,{'error':'Malformed request'})
        except Exception: self.respond(503,{'error':'Control service unavailable'})

    do_GET = dispatch
    do_POST = dispatch

ThreadingHTTPServer(('0.0.0.0',8091),Handler).serve_forever()
