"""Read-only network inspection using the host's existing instance identity.

Never creates IAM policies, reads user keys, or prints principal credentials.
Run in a disposable Oracle SDK container on the target instance.
"""
import json
import urllib.request
import oci


def metadata(path):
    request = urllib.request.Request('http://169.254.169.254/opc/v2/' + path,
                                     headers={'Authorization': 'Bearer Oracle'})
    return json.load(urllib.request.urlopen(request, timeout=5))


try:
    signer = oci.auth.signers.InstancePrincipalsSecurityTokenSigner()
    client = oci.core.VirtualNetworkClient({}, signer=signer, timeout=(5, 15),
                                           retry_strategy=oci.retry.NoneRetryStrategy())
    for nic in metadata('vnics/'):
        vnic = client.get_vnic(nic['vnicId']).data
        subnet = client.get_subnet(vnic.subnet_id).data
        print(json.dumps({'subnet': subnet.id, 'security_lists': subnet.security_list_ids,
                          'network_security_groups': vnic.nsg_ids}))
        for identity in subnet.security_list_ids:
            security = client.get_security_list(identity).data
            print(json.dumps({'security_list': security.display_name,
                              'ingress': [oci.util.to_dict(rule) for rule in security.ingress_security_rules]}))
        for identity in vnic.nsg_ids:
            rules = client.list_network_security_group_security_rules(identity).data
            print(json.dumps({'nsg': identity, 'ingress': [oci.util.to_dict(rule) for rule in rules if rule.direction == 'INGRESS']}))
except oci.exceptions.ServiceError as error:
    print(json.dumps({'status': error.status, 'code': error.code,
                      'result': 'Existing instance identity cannot inspect this network'}))
    raise SystemExit(2)
except Exception as error:
    print(json.dumps({'type': type(error).__name__, 'result': 'Instance network inspection unavailable'}))
    raise SystemExit(3)
