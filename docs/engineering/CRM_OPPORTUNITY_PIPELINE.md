# Opportunity pipeline ownership and iteration

## Architecture

The independent CRM currently creates an opportunity through qualified-lead
conversion and can read opportunities, but cannot change their pipeline stage.
The next transaction belongs to the CRM Go service and its React back office.
Do not call the portfolio TypeScript service to perform the write.

POST `/api/stations/crm/opportunity-stage` accepts `opportunityId`,
`expectedStageId`, `stageId`, `reason` and `requestId`. Organization, actor and
CRM grant come from the session. Only enabled back-office administrators and
operators can mutate; the selected opportunity, owner and target stage must
belong to that organization. Client identity fields are rejected.

## Program boundary

- The target stage defines probability and whether the opportunity is open,
  won or lost. Validate stage probability in 0..100 and reject a stage marked
  both won and lost. Won stages require probability 100 and lost stages 0.
  Closing a deal requires a bounded, nonblank reason;
  clear the reason belonging to the other outcome.
- Require the expected current stage so stale browser tabs cannot overwrite a
  concurrent transition. Retry the same actor/key/payload by returning the
  stored result; key reuse with different input or actor is a conflict.
- Calculate weighted amount using half-up integer rounding,
  `(amount * probability + 50) / 100`, for amounts in 0..9007199254740991
  and probability in 0..100, matching lead conversion. Retain the existing minor-unit
  amount. Do not silently change amount, owner, account or close date.
- Stage, probability, status, reasons, structured before/after audit and retry
  result commit atomically. An injected late audit/retry failure must leave
  all prior state unchanged. Closed opportunities can transition again only
  through an explicit authorized request with their current expected stage.
- Add stages only to authorized back-office query datasets. React selects a
  persisted opportunity and organization stage, shows current state and
  close reason, retains failed input/uncertain retry intent and refreshes on
  confirmed success. Preserve lead conversion, pagination and printing.

## Tests before code

First add real HTTP/SQLite tests for persisted stage/probability/status,
reason validation, actor/key replay, stale/concurrent updates, role/tenant
denial, exact weighted amount and late failure rollback. Observe remote
missing-endpoint evidence before implementing. Then add remote Chromium
English/Traditional Chinese, mobile and read-only acceptance before declaring
the feature stable. No local application tests or builds run.

This iteration does not complete quote generation, activities, support tickets,
independent OCI delivery or Windows encryption/device acceptance. Keep those
remaining gates visible rather than treating pipeline movement as full CRM.
