"""At-least-once delivery with transactional deduplication and bounded redelivery."""
import json
import os
import pika
from .gateway import database

connection = pika.BlockingConnection(pika.URLParameters(os.environ['AMQP_URL']))
channel = connection.channel()
channel.queue_declare(queue='commerce.dead', durable=True)
channel.queue_declare(queue='commerce.fulfillment', durable=True, arguments={'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': 'commerce.dead', 'x-max-length': 10000, 'x-overflow': 'reject-publish'})
channel.basic_qos(prefetch_count=8)

def consume(ch, method, properties, body):
    try:
        job = json.loads(body)
        with database(job['tenant']) as db:
            # One transaction makes duplicate deliveries harmless.
            inserted = db.execute('INSERT INTO processed_events(tenant_id,event_id) VALUES (%s,%s) ON CONFLICT DO NOTHING RETURNING event_id', (job['tenant'], job['event_id'])).fetchone()
            if inserted:
                db.execute('INSERT INTO fulfillment_jobs(tenant_id,event_id,order_id) VALUES (%s,%s,%s)', (job['tenant'], job['event_id'], job['order_id']))
        ch.basic_ack(method.delivery_tag)
    except Exception:
        ch.basic_nack(method.delivery_tag, requeue=not method.redelivered)

channel.basic_consume(queue='commerce.fulfillment', on_message_callback=consume)
channel.start_consuming()
