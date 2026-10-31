"""Bounded, deterministic per-device novelty model. Never trains on the scored point.

The digest identifies training values and algorithm settings, not a serialized
executable artifact. The immutable assessment is persisted with each event.
"""
import hashlib
import json
from functools import lru_cache
import sklearn
from sklearn.ensemble import IsolationForest

ALGORITHM = 'isolation-forest-v1'
MIN_SAMPLES = 64
MAX_SAMPLES = 256


@lru_cache(maxsize=64)
def _fit(history):
    model = IsolationForest(n_estimators=64, max_samples=MAX_SAMPLES,
                            contamination=0.02, random_state=42, n_jobs=1)
    model.fit([[v] for v in history])
    identity = json.dumps([ALGORITHM, sklearn.__version__, history], separators=(',', ':'))
    return model, hashlib.sha256(identity.encode()).hexdigest()


def assess(value, history):
    history = tuple(float(v) for v in history[:MAX_SAMPLES])
    result = dict(algorithm=ALGORITHM, library=sklearn.__version__, samples=len(history),
                  status='warming_up', model_id=None, score=None, threshold=None, anomaly=False)
    if len(history) < MIN_SAMPLES:
        return result
    if len(set(history)) < 2:
        return {**result, 'status': 'insufficient_variation'}
    model, identity = _fit(history)
    # score_samples has lower values for outliers; expose larger = more unusual.
    score = -float(model.score_samples([[value]])[0])
    threshold = -float(model.offset_)
    return {**result, 'status': 'ready', 'model_id': identity,
            'score': score, 'threshold': threshold, 'anomaly': score > threshold}
