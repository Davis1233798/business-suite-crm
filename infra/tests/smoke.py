"""Run real service assertions inside the gateway, without printing credentials."""
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[1]
code = r'''
import json, os, time, uuid, urllib.request, urllib.error
import psycopg
import paho.mqtt.publish as publish
from runtime.policy import shard_for
tenant = 'smoke_' + uuid.uuid4().hex
headers = {'Authorization': 'Bearer ' + os.environ['GATEWAY_TOKEN'], 'Content-Type': 'application/json'}
def request(path, method='GET', body=None):
    req = urllib.request.Request('http://127.0.0.1:8080' + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)
def eventually(check):
    for _ in range(40):
        result = check()
        if result: return result
        time.sleep(.5)
    raise AssertionError('Timed out waiting for service result')
try:
    urllib.request.urlopen('http://127.0.0.1:8080/industrial/' + tenant)
    raise AssertionError('Anonymous access allowed')
except urllib.error.HTTPError as error:
    assert error.code == 401
request('/cache/' + tenant + '/test', 'PUT', {'value': [{'name': 'isolated'}]})
assert request('/cache/' + tenant + '/test')['value'][0]['name'] == 'isolated'
assert request('/cache/other_' + tenant + '/test')['value'] is None
for i in range(2):
    target = next('factory_' + str(n) for n in range(100) if shard_for('factory_' + str(n)) == i)
    with psycopg.connect(os.environ[f'SHARD_{i}_URL']) as db:
        db.execute('INSERT INTO mes_work_orders(tenant_id,id,payload) VALUES (%s,%s,%s)', (target, tenant, '{}'))
        partition = db.execute('SELECT tableoid::regclass::text FROM mes_work_orders WHERE tenant_id=%s AND id=%s', (target, tenant)).fetchone()[0]
        assert partition.startswith('mes_work_orders_p')
        db.execute('DELETE FROM mes_work_orders WHERE tenant_id=%s AND id=%s', (target, tenant))
    projection_tenant = next(tenant+'_'+str(n) for n in range(100) if shard_for(tenant+'_'+str(n)) == i)
    path = '/mes/'+projection_tenant+'/work-orders/order1'
    snapshot = dict(revision=2,deleted=False,order=dict(id='order1',organizationId=projection_tenant,orderNo='WO-SMOKE',completedQuantity=2),quality={},operations={})
    assert request(path,'PUT',snapshot)['applied']
    assert not request(path,'PUT',{**snapshot,'revision':1})['applied']
    current = request('/mes/'+projection_tenant+'/work-orders')['workOrders']
    assert len(current)==1 and current[0]['revision']==2
    assert request(path,'PUT',{**snapshot,'revision':3,'deleted':True,'order':None})['applied']
    assert not request(path,'PUT',snapshot)['applied']
    assert not request('/mes/'+projection_tenant+'/work-orders')['workOrders']
    assert not request('/mes/other_'+projection_tenant+'/work-orders')['workOrders']
job = {'tenant': tenant, 'event_id': 'job1', 'order_id': 'order1'}
request('/commerce/jobs', 'POST', job)
request('/commerce/jobs', 'POST', job)
def count_jobs():
    with psycopg.connect(os.environ[f'SHARD_{shard_for(tenant)}_URL']) as db:
        return db.execute('SELECT count(*) FROM fulfillment_jobs WHERE tenant_id=%s', (tenant,)).fetchone()[0]
eventually(count_jobs)
time.sleep(1)
assert count_jobs() == 1
payload = dict(tenant=tenant, device='machine1', event_id='reading1', timestamp='2026-10-30T00:00:00Z', value=20)
for _ in range(2):
    publish.single(f'factory/{tenant}/machine1/telemetry', json.dumps(payload), qos=1, hostname='mqtt', auth={'username': os.environ['MQTT_USER'], 'password': os.environ['MQTT_PASSWORD']})
eventually(lambda: request('/industrial/' + tenant)['measurements'])
time.sleep(1)
assert len(request('/industrial/' + tenant)['measurements']) == 1
assert not request('/industrial/other_' + tenant)['measurements']
from datetime import datetime, timezone, timedelta
import random
start = datetime.now(timezone.utc) - timedelta(minutes=10)
rng = random.Random(42)
signals = [rng.gauss(20,1) for _ in range(64)] + [100]
messages = [dict(topic=f'factory/{tenant}/ai-machine/telemetry', qos=1, payload=json.dumps(dict(tenant=tenant, device='ai-machine',event_id='ai-'+str(i),timestamp=(start+timedelta(seconds=i)).isoformat(),value=value))) for i,value in enumerate(signals)]
publish.multiple(messages, hostname='mqtt', auth={'username':os.environ['MQTT_USER'],'password':os.environ['MQTT_PASSWORD']})
def trained_fault():
    return next((r for r in request('/industrial/'+tenant)['measurements'] if r['device']=='ai-machine' and r['value']==100), None)
fault = eventually(trained_fault)
assert fault['anomaly'] and fault['assessment']['status']=='ready'
assert fault['assessment']['samples']==64
assert len(fault['assessment']['model_id'])==64
assert fault['assessment']['score'] > fault['assessment']['threshold']
# A late reading cannot train against any packets from its future.
late = dict(tenant=tenant,device='ai-machine',event_id='ai-late',timestamp=(start-timedelta(seconds=1)).isoformat(),value=200)
publish.single(f'factory/{tenant}/ai-machine/telemetry',json.dumps(late),qos=1,hostname='mqtt',auth={'username':os.environ['MQTT_USER'],'password':os.environ['MQTT_PASSWORD']})
def late_reading():
    return next((r for r in request('/industrial/'+tenant)['measurements'] if r['device']=='ai-machine' and r['value']==200), None)
assert eventually(late_reading)['assessment']['samples']==0
assert not request('/industrial/other_'+tenant)['measurements']
print('PASS: real MQTT model training, persisted score/provenance, fault inference and late-packet temporal isolation')
print('PASS: service authentication, Redis isolation, PostgreSQL shards/partitions and monotonic MES projections/tombstones, RabbitMQ deduplication, MQTT to TimescaleDB and tenant isolation')
'''
subprocess.run(['docker', 'compose', '--project-directory', str(root), '-f', str(root / 'compose.yaml'), 'exec', '-T', 'gateway', 'python', '-'], input=code, text=True, check=True)
