import {dispatchCommerceOutbox} from "./commerce-outbox";
import {dispatchMesProjections} from "./mes-projection";

export async function dispatchInfrastructureOutbox() {
  const commerce=await dispatchCommerceOutbox();
  const mes=await dispatchMesProjections();
  return {...commerce,mesSynced:mes.sent};
}
