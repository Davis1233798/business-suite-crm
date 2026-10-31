import hashlib
import json
import math
import re
import statistics
from datetime import datetime

def shard_for(tenant):
    if not isinstance(tenant, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', tenant):
        raise ValueError('Invalid tenant')
    return int.from_bytes(hashlib.sha256(tenant.encode()).digest()[:8], 'big') % 2

def cache_key(tenant, query):
    shard_for(tenant)
    return 'catalog:' + tenant + ':' + hashlib.sha256(json.dumps(query, sort_keys=True).encode()).hexdigest()

def validate_telemetry(topic, payload):
    tenant, device = payload.get('tenant'), payload.get('device')
    shard_for(tenant)
    if not isinstance(device, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', device):
        raise ValueError('Invalid device')
    if topic != f'factory/{tenant}/{device}/telemetry':
        raise ValueError('Topic identity mismatch')
    value = payload.get('value')
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Invalid measurement')
    if not isinstance(payload.get('event_id'), str) or not 1 <= len(payload['event_id']) <= 128:
        raise ValueError('Invalid event identity')
    timestamp = datetime.fromisoformat(payload['timestamp'].replace('Z', '+00:00'))
    if timestamp.tzinfo is None:
        raise ValueError('Timezone required')
    return payload

def anomaly(value, history):
    if len(history) < 5:
        return False
    mean = statistics.mean(history)
    deviation = statistics.pstdev(history)
    return abs(value - mean) > max(3 * deviation, abs(mean) * 0.1, 0.001)
