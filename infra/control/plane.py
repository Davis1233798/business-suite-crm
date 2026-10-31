"""Allowlisted, one-use operation plans derived from the shipped IaC graph."""
import secrets
import threading
import time

class ControlError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status

class ControlPlane:
    def __init__(self, engine, graph, sites, clock=time.time, audit=lambda event: None):
        self.engine, self.graph, self.sites = engine, graph, sites
        self.clock, self.audit = clock, audit
        self.plans = {}
        self.lock = threading.Lock()
        for name in graph: self.dependencies(name)

    def dependencies(self, service, trail=()):
        if service not in self.graph or service in trail:
            raise ControlError('Invalid service graph')
        result = []
        for dependency in self.graph[service]:
            for name in self.dependencies(dependency, (*trail,service)):
                if name not in result: result.append(name)
        if service not in result: result.append(service)
        return result

    def scope(self, site):
        if site not in self.sites: raise ControlError('Unknown station')
        return {name for root in ['web',*self.sites[site]] for name in self.dependencies(root)}

    def status(self):
        rows = self.engine.inventory()
        return {'services': [rows.get(name, {'service':name,'state':'missing','health':'unknown'}) for name in sorted(self.graph)], 'sites': list(self.sites)}

    @staticmethod
    def fingerprint(row):
        return tuple(row.get(key) for key in ('id','state','started','health'))

    def plan(self, site, service, action):
        if action not in ('start','stop','restart') or service not in self.scope(site):
            raise ControlError('Operation outside declared station scope')
        with self.lock:
            now = self.clock()
            self.plans = {key:value for key,value in self.plans.items() if value['expires_at'] > now}
            if len(self.plans) >= 100: raise ControlError('Too many pending plans',429)
            inventory = self.engine.inventory()
            dependencies = self.dependencies(service)
            names = dependencies if action == 'start' else [service]
            if any(name not in inventory for name in dependencies):
                raise ControlError('Service not provisioned; apply the Compose configuration first',409)
            if action == 'restart' and inventory[service]['state'] != 'running':
                raise ControlError('Start a stopped service before restarting it',409)
            steps = [{'service':name,'action':action} for name in names if not (
                action == 'start' and inventory[name]['state'] == 'running' or
                action == 'stop' and inventory[name]['state'] != 'running')]
            affected = sorted(name for name in self.sites if any(step['service'] in self.scope(name) for step in steps))
            plan = {'plan_id':secrets.token_urlsafe(24),'site':site,'service':service,'action':action,'steps':steps,'affected_sites':affected,'expires_at':now+90}
            self.plans[plan['plan_id']] = {**plan,'snapshot':{name:self.fingerprint(inventory[name]) for name in dependencies}}
            return plan

    def apply(self, plan_id):
        with self.lock:
            plan = self.plans.pop(plan_id, None)
            if not plan or plan['expires_at'] <= self.clock(): raise ControlError('Plan expired or already consumed',410)
            inventory = self.engine.inventory()
            if any(name not in inventory or self.fingerprint(inventory[name]) != fingerprint for name,fingerprint in plan['snapshot'].items()):
                raise ControlError('Service state changed; create a new plan',409)
            completed = []
            event = {key:plan[key] for key in ('plan_id','site','service','action','affected_sites')}
            try:
                for step in plan['steps']:
                    self.engine.operate(inventory[step['service']],step['action'])
                    completed.append(step)
            except Exception as error:
                self.audit({**event,'result':'failed','completed':completed})
                raise ControlError('Operation failed; inspect status before creating a new plan',503) from error
            self.audit({**event,'result':'completed','completed':completed})
            return {'status':'completed','plan_id':plan_id,'steps':completed, **self.status()}
