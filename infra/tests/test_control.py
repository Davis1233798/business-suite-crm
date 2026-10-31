import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control.plane import ControlPlane, ControlError
from control.engine import DockerEngine

class Engine:
    def __init__(self):
        self.rows = {name: dict(service=name, id=name+'-id', state='running', started='v1', health='healthy') for name in ['web','gateway','redis','collector']}
        self.calls = []
    def inventory(self): return {k: dict(v) for k,v in self.rows.items()}
    def operate(self, row, action):
        self.calls.append((row['service'],action))
        self.rows[row['service']]['state'] = 'exited' if action == 'stop' else 'running'
        self.rows[row['service']]['started'] = 'v2'

class ControlTests(unittest.TestCase):
    def setUp(self):
        self.engine = Engine()
        self.clock = [100]
        self.audit = []
        self.plane = ControlPlane(self.engine, {'web':['gateway'],'gateway':['redis'],'redis':[],'collector':['gateway']}, {'mes':['collector'],'erp':[]}, clock=lambda:self.clock[0], audit=self.audit.append)

    def test_plan_has_shared_station_impact_and_does_not_mutate(self):
        plan = self.plane.plan('mes','web','restart')
        self.assertEqual(plan['affected_sites'], ['erp','mes'])
        self.assertEqual(self.engine.calls, [])
        self.plane.apply(plan['plan_id'])
        self.assertEqual(self.engine.calls, [('web','restart')])
        self.assertEqual(self.audit[-1]['result'], 'completed')
        with self.assertRaises(ControlError): self.plane.apply(plan['plan_id'])

    def test_rejects_outside_scope_shell_input_and_drift(self):
        for args in [('erp','collector','stop'),('mes','host-shell','restart'),('mes','collector','exec')]:
            with self.assertRaises(ControlError): self.plane.plan(*args)
        plan = self.plane.plan('mes','collector','restart')
        self.engine.rows['collector']['id'] = 'replacement'
        with self.assertRaises(ControlError): self.plane.apply(plan['plan_id'])
        self.assertEqual(self.engine.calls, [])

    def test_expired_plan_cannot_execute(self):
        plan = self.plane.plan('mes','collector','stop')
        self.clock[0] += 91
        with self.assertRaises(ControlError): self.plane.apply(plan['plan_id'])
        self.assertEqual(self.engine.calls, [])

    def test_station_runtime_stop_affects_only_that_station(self):
        for station in ('mes','erp'):
            name = 'web-' + station
            self.engine.rows[name] = dict(service=name,id=name,state='running',started='v1',health='healthy')
        self.plane.graph.update({'web-mes':['web'],'web-erp':['web']})
        self.plane.sites = {'mes':['web-mes','collector'],'erp':['web-erp']}
        planned = self.plane.plan('mes','web-mes','stop')
        self.assertEqual(planned['affected_sites'],['mes'])
        self.plane.apply(planned['plan_id'])
        self.assertEqual(self.engine.rows['web-erp']['state'],'running')
        self.assertEqual(self.engine.rows['web']['state'],'running')
        with self.assertRaises(ControlError): self.plane.plan('erp','web-mes','stop')

    def test_start_orders_stopped_dependencies_before_target(self):
        for row in self.engine.rows.values(): row['state'] = 'exited'
        plan = self.plane.plan('mes','collector','start')
        self.plane.apply(plan['plan_id'])
        self.assertEqual(self.engine.calls, [('redis','start'),('gateway','start'),('collector','start')])

    def test_failed_operation_consumes_plan_and_records_failure(self):
        plan = self.plane.plan('mes','collector','restart')
        def fail(*args): raise RuntimeError('engine unavailable')
        self.engine.operate = fail
        with self.assertRaises(ControlError): self.plane.apply(plan['plan_id'])
        self.assertEqual(self.audit[-1]['result'], 'failed')
        with self.assertRaises(ControlError): self.plane.apply(plan['plan_id'])

    def test_engine_rechecks_container_project_before_mutation(self):
        engine = DockerEngine('business-suite',{'collector':[]})
        calls = []
        def request(method,path):
            calls.append((method,path))
            return {'Config':{'Labels':{'com.docker.compose.project':'unrelated','com.docker.compose.service':'collector'}}}
        engine.request = request
        with self.assertRaises(RuntimeError): engine.operate({'id':'container','service':'collector'},'restart')
        self.assertTrue(all(method=='GET' for method,path in calls))

if __name__ == '__main__': unittest.main()
