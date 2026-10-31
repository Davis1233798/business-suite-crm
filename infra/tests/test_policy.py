import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime.policy import shard_for, cache_key, validate_telemetry, anomaly

class PolicyTests(unittest.TestCase):
    def test_shard_is_stable_and_bounded(self):
        self.assertEqual(shard_for('factory-a'), shard_for('factory-a'))
        self.assertEqual({shard_for(str(i)) for i in range(100)}, {0, 1})
        with self.assertRaises(ValueError): shard_for('')

    def test_cache_is_tenant_isolated(self):
        self.assertNotEqual(cache_key('a', {'q': 'x'}), cache_key('b', {'q': 'x'}))
        self.assertEqual(cache_key('a', {'a': 1, 'b': 2}), cache_key('a', {'b': 2, 'a': 1}))

    def test_mqtt_identity_and_values(self):
        payload = dict(event_id='e1', tenant='a', device='m1', value=80, timestamp='2026-10-30T00:00:00Z')
        self.assertEqual(validate_telemetry('factory/a/m1/telemetry', payload)['value'], 80)
        with self.assertRaises(ValueError): validate_telemetry('factory/b/m1/telemetry', payload)
        with self.assertRaises(ValueError): validate_telemetry('factory/a/m1/telemetry', {**payload, 'value': float('nan')})

    def test_anomaly_requires_baseline(self):
        self.assertFalse(anomaly(100, []))
        self.assertTrue(anomaly(100, [20, 21, 19, 20, 21]))
        self.assertFalse(anomaly(20, [20, 21, 19, 20, 21]))

if __name__ == '__main__': unittest.main()
