import json
import os
import logging
import paho.mqtt.client as mqtt
import psycopg
from psycopg.types.json import Jsonb
from .policy import validate_telemetry, anomaly
from .intelligence import assess


def migrate():
    # Existing named volumes do not rerun Docker entrypoint init scripts.
    with psycopg.connect(os.environ['TIMESERIES_URL']) as db:
        db.execute('SELECT pg_advisory_xact_lock(76190431)')
        db.execute('ALTER TABLE telemetry ADD COLUMN IF NOT EXISTS assessment jsonb')

def on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        client.subscribe('factory/+/+/telemetry', qos=1)

def on_message(client, userdata, message):
    try:
        data = validate_telemetry(message.topic, json.loads(message.payload))
    except (ValueError, KeyError, TypeError):
        logging.exception('Invalid telemetry discarded')
        client.ack(message.mid, message.qos)
        return
    try:
        with psycopg.connect(os.environ['TIMESERIES_URL']) as db:
            # Serialize each device baseline so concurrent collectors cannot race.
            db.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (data['tenant'] + ':' + data['device'],))
            inserted = db.execute('INSERT INTO telemetry_events(tenant_id,event_id) VALUES (%s,%s) ON CONFLICT DO NOTHING RETURNING event_id', (data['tenant'], data['event_id'])).fetchone()
            if inserted:
                # Strictly earlier event time prevents future leakage for late packets.
                history = db.execute('SELECT value,time FROM telemetry WHERE tenant_id=%s AND device_id=%s AND time < %s ORDER BY time DESC,event_id DESC LIMIT 256', (data['tenant'], data['device'], data['timestamp'])).fetchall()
                values = [r[0] for r in history]
                assessment = assess(data['value'], values)
                assessment['window_start'] = history[-1][1].isoformat() if history else None
                assessment['window_end'] = history[0][1].isoformat() if history else None
                assessment['decision_method'] = 'model' if assessment['status'] == 'ready' else 'statistical-fallback'
                flagged = assessment['anomaly'] if assessment['status'] == 'ready' else anomaly(data['value'], values[:30])
                db.execute('INSERT INTO telemetry(time,tenant_id,device_id,event_id,value,is_anomaly,assessment) VALUES (%s,%s,%s,%s,%s,%s,%s)', (data['timestamp'], data['tenant'], data['device'], data['event_id'], data['value'], flagged, Jsonb(assessment)))
        client.ack(message.mid, message.qos)
    except Exception:
        logging.exception('Telemetry rejected or storage unavailable; message remains unacknowledged')
        raise  # Restart the persistent client session to replay the unacknowledged message.

migrate()
client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='business-suite-collector', clean_session=False, manual_ack=True)
client.username_pw_set(os.environ['MQTT_USER'], os.environ['MQTT_PASSWORD'])
client.on_connect = on_connect
client.on_message = on_message
client.connect(os.environ.get('MQTT_HOST', 'mqtt'), 1883)
client.loop_forever()
