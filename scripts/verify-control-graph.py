"""Verify the operator's allowlist graph against actual Compose dependencies."""
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
result = subprocess.run(['docker','compose','--project-directory',str(root/'infra'),'-f',str(root/'infra/compose.yaml'),'-f',str(root/'infra/linux/compose.web.yaml'),'config','--format','json'],capture_output=True,text=True,check=True)
services = json.loads(result.stdout)['services']
graph = json.loads((root/'infra/control/services.json').read_text())
for name, dependencies in graph.items():
    assert name in services, 'Control allowlist contains an undeclared service'
    assert set(dependencies) == set(services[name].get('depends_on',{})), f'Dependency graph drift: {name}'
assert set(graph) == set(services)-{'control'}, 'Declare every managed service explicitly'
print('PASS: control graph matches Compose; control agent cannot target itself')
