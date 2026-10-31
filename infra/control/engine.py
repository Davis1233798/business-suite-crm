import http.client
import json
import socket
import time
import urllib.parse

class UnixHTTP(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.sock.settimeout(20)
        self.sock.connect('/var/run/docker.sock')

class DockerEngine:
    def __init__(self, project, graph):
        self.project, self.graph = project, graph

    def request(self, method, path):
        connection = UnixHTTP('docker')
        try:
            connection.request(method,'/v1.47'+path)
            response = connection.getresponse()
            body = response.read()
            if response.status not in (200,204,304): raise RuntimeError('Docker operation failed')
            return json.loads(body) if body else None
        finally: connection.close()

    def inspect(self, container_id):
        return self.request('GET','/containers/'+container_id+'/json')

    def inventory(self):
        filters = urllib.parse.quote(json.dumps({'label':['com.docker.compose.project='+self.project]}))
        containers = self.request('GET','/containers/json?all=1&filters='+filters)
        result = {}
        for container in containers:
            name = container.get('Labels',{}).get('com.docker.compose.service')
            if name not in self.graph: continue
            if name in result: raise RuntimeError('Replicated service requires a separate rollout plan')
            details = self.inspect(container['Id'])
            state = details['State']
            result[name] = dict(service=name,id=container['Id'],state=state['Status'],started=state['StartedAt'],health=state.get('Health',{}).get('Status','not_configured'))
        return result

    def operate(self, row, action):
        # Recheck immutable identity and project labels immediately before mutation.
        details = self.inspect(row['id'])
        labels = details['Config'].get('Labels',{})
        if labels.get('com.docker.compose.project') != self.project or labels.get('com.docker.compose.service') != row['service']:
            raise RuntimeError('Container ownership changed')
        self.request('POST','/containers/'+row['id']+'/'+action+('' if action == 'start' else '?t=10'))
        for _ in range(60):
            state = self.inspect(row['id'])['State']
            ready = state['Status'] != 'running' if action == 'stop' else state['Status'] == 'running' and state.get('Health',{}).get('Status','healthy') == 'healthy'
            if ready: return
            if state.get('Health',{}).get('Status') == 'unhealthy': break
            time.sleep(.5)
        raise RuntimeError('Service did not reach its expected state')
