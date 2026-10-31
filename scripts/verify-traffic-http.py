"""Exercise the same traffic-lab HTTP workflow as the browser using a disposable Go process/database."""
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def main():
    with tempfile.TemporaryDirectory(prefix="suite-traffic-") as directory:
        executable = Path(directory) / ("suite.exe" if os.name == "nt" else "suite")
        subprocess.run(["go", "build", "-o", str(executable), "."], cwd=ROOT / "backend", check=True)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        env = {**os.environ, "SUITE_DB": str(Path(directory) / "lab.sqlite"), "SUITE_ADDR": f"127.0.0.1:{port}", "SUITE_WEB": str(ROOT / "web-dist")}
        process = subprocess.Popen([str(executable)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        base = f"http://127.0.0.1:{port}"
        try:
            for _ in range(100):
                try:
                    urllib.request.urlopen(base + "/api/health", timeout=1).close()
                    break
                except (OSError, urllib.error.HTTPError):
                    if process.poll() is not None:
                        raise RuntimeError("Temporary Go server exited")
                    time.sleep(.1)
            else:
                raise RuntimeError("Temporary server did not become ready")
            def http(path, body=None, cookie=""):
                request = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json", "Cookie": cookie})
                with urllib.request.urlopen(request, timeout=20) as response:
                    value = json.load(response)
                    assert value["success"], value
                    return value["data"], response.headers.get_all("Set-Cookie", [])
            summaries = []
            for site in ["shop", "mes"]:
                space = "suite_demo_space=" + secrets.token_hex(32)
                _, cookies = http("/api/auth/login", {"email": "admin@suite.test", "password": "SuiteDemo!2026", "site": site}, space)
                cookie = "; ".join(c.split(";", 1)[0] for c in cookies)
                for capacity in [20, 80]:
                    prepared, _ = http(f"/api/stations/{site}/traffic", {"action": "prepare", "capacity": capacity}, cookie)
                    run = prepared["runId"]
                    def submit(index):
                        key = index - 1 if index % 5 == 4 else index
                        return http(f"/api/stations/{site}/traffic", {"action": "submit", "runId": run, "key": f"event-{key}"}, cookie)[0]["outcome"]
                    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
                        outcomes = list(pool.map(submit, range(128)))
                    state, _ = http(f"/api/stations/{site}/traffic?runId={run}", cookie=cookie)
                    assert state["committed"] == capacity and state["remaining"] == 0, state
                    assert state["queued"] + state["processed"] == state["committed"], state
                    assert outcomes.count("accepted") == capacity and "duplicate" in outcomes, outcomes
                    assert state["records"][0]["sequence"] == capacity, state
                    for _ in range(2):
                        state, _ = http(f"/api/stations/{site}/traffic", {"action": "drain", "runId": run}, cookie)
                        assert state["queued"] == 0 and state["processed"] == capacity, state
                    summaries.append({"site": site, "requests": len(outcomes), "workers": 16, "capacity": capacity, "outcomes": {key: outcomes.count(key) for key in sorted(set(outcomes))}, "invariant": True, "consumerIdempotent": True})
                _, viewer_cookies = http("/api/auth/login", {"email": "viewer@suite.test", "password": "SuiteDemo!2026", "site": site}, space)
                viewer = "; ".join(c.split(";", 1)[0] for c in viewer_cookies)
                try:
                    http(f"/api/stations/{site}/traffic", {"action": "prepare", "capacity": 20}, viewer)
                    raise AssertionError("Read-only account wrote lab state")
                except urllib.error.HTTPError as error:
                    assert error.code == 403
            print(json.dumps(summaries, indent=2))
        finally:
            process.terminate()
            process.wait(timeout=10)

if __name__ == "__main__":
    main()
