"""Internal service gateway. Never expose directly to untrusted clients."""
import json
import os
import secrets
import hashlib
import redis
import pika
import psycopg
from fastapi import FastAPI, Header, HTTPException, Depends
from pydantic import BaseModel, Field
from .policy import cache_key, shard_for
from psycopg.types.json import Jsonb

app = FastAPI(title='Business Suite infrastructure gateway')
cache = redis.Redis.from_url(os.environ['REDIS_URL'], decode_responses=True, socket_timeout=2)

def authorize(authorization: str = Header(default='')):
    if not secrets.compare_digest(authorization, 'Bearer ' + os.environ['GATEWAY_TOKEN']):
        raise HTTPException(401, 'Service authentication required')

def database(tenant):
    return psycopg.connect(os.environ[f'SHARD_{shard_for(tenant)}_URL'])

@app.get('/health')
def health():
    return {'status': 'process-ready'}

class CachedValue(BaseModel):
    value: list[dict] = Field(max_length=100)

@app.get('/cache/{tenant}/{key}', dependencies=[Depends(authorize)])
def read_cache(tenant: str, key: str):
    value = cache.get(cache_key(tenant, {'key': key}))
    return {'value': json.loads(value) if value is not None else None}

@app.put('/cache/{tenant}/{key}', dependencies=[Depends(authorize)])
def write_cache(tenant: str, key: str, body: CachedValue):
    cache.setex(cache_key(tenant, {'key': key}), 30, json.dumps(body.value))
    return {'stored': True}

@app.get('/industrial/{tenant}', dependencies=[Depends(authorize)])
def industrial(tenant: str):
    shard_for(tenant)
    with psycopg.connect(os.environ['TIMESERIES_URL']) as db:
        rows = db.execute("SELECT time,device_id,value,is_anomaly,to_jsonb(telemetry)->'assessment' FROM telemetry WHERE tenant_id=%s ORDER BY time DESC LIMIT 100", (tenant,)).fetchall()
    return {'measurements': [dict(time=r[0].isoformat(), device=r[1], value=r[2], anomaly=r[3], assessment=r[4]) for r in rows], 'shard': shard_for(tenant)}

class MesProjection(BaseModel):
    revision: int = Field(ge=1, le=9007199254740991, strict=True)
    deleted: bool
    order: dict | None = None
    quality: dict = Field(default_factory=dict)
    operations: dict = Field(default_factory=dict)

@app.put('/mes/{tenant}/work-orders/{order_id}', dependencies=[Depends(authorize)])
def project_work_order(tenant: str, order_id: str, body: MesProjection):
    shard_for(tenant)
    if not 1 <= len(order_id) <= 256:
        raise HTTPException(400,'Invalid work order identity')
    if not body.deleted and (not body.order or body.order.get('id') != order_id or body.order.get('organizationId') != tenant):
        raise HTTPException(400,'Projection tenant or order mismatch')
    if body.deleted and body.order is not None:
        raise HTTPException(400,'A tombstone must not contain order data')
    with database(tenant) as db:
        result = db.execute('''INSERT INTO mes_work_orders(tenant_id,id,payload) VALUES (%s,%s,%s)
            ON CONFLICT(tenant_id,id) DO UPDATE SET payload=EXCLUDED.payload
            WHERE COALESCE((mes_work_orders.payload->>'revision')::bigint,0) < (EXCLUDED.payload->>'revision')::bigint
            RETURNING tableoid::regclass::text''', (tenant,order_id,Jsonb(body.model_dump()))).fetchone()
    return {'applied': result is not None, 'shard': shard_for(tenant)}

@app.get('/mes/{tenant}/work-orders', dependencies=[Depends(authorize)])
def projected_work_orders(tenant: str):
    with database(tenant) as db:
        rows = db.execute("SELECT payload FROM mes_work_orders WHERE tenant_id=%s AND payload->>'deleted' IS DISTINCT FROM 'true' ORDER BY payload->'order'->>'createdAt' DESC,id LIMIT 100", (tenant,)).fetchall()
    return {'workOrders':[row[0] for row in rows], 'shard':shard_for(tenant), 'source':'postgresql-projection'}

@app.get('/catalog/{tenant}', dependencies=[Depends(authorize)])
def catalog(tenant: str):
    key = cache_key(tenant, {})
    try:
        cached = cache.get(key)
        if cached is not None:
            return {'source': 'cache', 'products': json.loads(cached)}
    except redis.RedisError:
        pass
    # Stock and checkout decisions must always use authoritative transactional data.
    with database(tenant) as db:
        rows = db.execute('SELECT id, name, price FROM catalog WHERE tenant_id=%s ORDER BY id LIMIT 100', (tenant,)).fetchall()
    result = [dict(id=r[0], name=r[1], price=r[2]) for r in rows]
    try:
        cache.setex(key, 30, json.dumps(result))
    except redis.RedisError:
        pass
    return {'source': 'database', 'products': result}

class Job(BaseModel):
    tenant: str = Field(min_length=1, max_length=64)
    event_id: str = Field(min_length=1, max_length=128)
    order_id: str = Field(min_length=1, max_length=128)

@app.post('/commerce/jobs', status_code=202, dependencies=[Depends(authorize)])
def enqueue(job: Job):
    shard_for(job.tenant)
    connection = pika.BlockingConnection(pika.URLParameters(os.environ['AMQP_URL']))
    try:
        channel = connection.channel()
        channel.queue_declare(queue='commerce.dead', durable=True)
        channel.queue_declare(queue='commerce.fulfillment', durable=True, arguments={'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'commerce.dead', 'x-max-length': 10000, 'x-overflow': 'reject-publish'})
        channel.confirm_delivery()
        channel.basic_publish(exchange='', routing_key='commerce.fulfillment', body=job.model_dump_json(), mandatory=True, properties=pika.BasicProperties(delivery_mode=2, message_id=hashlib.sha256((job.tenant + ':' + job.event_id).encode()).hexdigest()))
    finally:
        connection.close()
    return {'status': 'queued', 'event_id': job.event_id}
