import sys
import unittest
import random
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from runtime.intelligence import assess


class IntelligenceTests(unittest.TestCase):
    def test_warmup_is_explicit_and_never_claims_trained_model(self):
        result = assess(100, [20, 21, 19, 20, 21])
        self.assertEqual(result['status'], 'warming_up')
        self.assertIsNone(result['score'])
        self.assertIsNone(result['model_id'])

    def test_training_uses_history_only_and_is_reproducible(self):
        history = [random.Random(i).gauss(20, 1) for i in range(256)]
        normal = assess(20, history)
        fault = assess(100, history)
        self.assertEqual(normal['model_id'], fault['model_id'])
        self.assertEqual(normal, assess(20, history))
        self.assertFalse(normal['anomaly'])
        self.assertTrue(fault['anomaly'])
        self.assertGreater(fault['score'], normal['score'])
        self.assertEqual(normal['samples'], 256)

    def test_constant_history_does_not_pretend_model_is_informative(self):
        result = assess(100, [20] * 256)
        self.assertEqual(result['status'], 'insufficient_variation')
        self.assertIsNone(result['model_id'])

    def test_held_out_synthetic_faults_and_normal_readings(self):
        rng = random.Random(42)
        history = [rng.gauss(20, 1) for _ in range(256)]
        normal = [rng.gauss(20, 1) for _ in range(100)]
        faults = [rng.gauss(30, 1) for _ in range(20)]
        false_positives = sum(assess(x, history)['anomaly'] for x in normal)
        true_positives = sum(assess(x, history)['anomaly'] for x in faults)
        self.assertLessEqual(false_positives, 12)
        self.assertGreaterEqual(true_positives, 18)


if __name__ == '__main__':
    unittest.main()
