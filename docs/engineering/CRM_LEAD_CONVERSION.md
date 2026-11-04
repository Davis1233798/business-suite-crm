# CRM lead qualification and conversion

## Scope

Move the CRM lead-to-account flow into the Go + React station. The current TypeScript `CrmService` defines conversion as creating one account, one contact and one opportunity, then recording their identifiers on the lead. The active CRM workspace is served by `backend/` and `web/src`; the TypeScript CRM remains a behavior reference and is not the transaction owner for the Go workspace.

## API and trust boundary

Expose CRM lead mutations through the authenticated `/api/stations/crm/...` station API. The server resolves organization, actor and CRM grant from the current session. Mutations require an enabled back-office `operator` or `admin` CRM grant. Front-office, read-only, anonymous, revoked-session and cross-organization requests fail without writes. Request bodies do not accept organization or actor identity. Lead assignment is set by the server to the current actor; any supported reassignment must validate an active same-organization CRM identity.

Lead creation persists name, company, email and phone with bounded validation. Qualification is a state transition from `new` to `qualified`; invalid transitions fail. Conversion accepts only a qualified lead and requires a non-negative integer amount in the CRM's minor-unit convention and a valid ISO calendar close date. It uses an organization-owned initial CRM stage and the lead's validated owner. No synthetic financial defaults are allowed.

## Atomic conversion

Conversion runs in one SQLite transaction. A conditional transition claims the qualified lead before creating related rows; account, contact, opportunity and all three lead reference fields commit together. Unique deterministic IDs and the conditional transition ensure repeated or concurrent conversion cannot create duplicates. Already-converted leads return a conflict with no mutation. Any validation, uniqueness, foreign key or injected late insert failure rolls the transaction back, leaving the lead qualified and creating no partial account/contact/opportunity.

All linked records carry the session organization ID. The selected stage and owner must belong to that organization. The server returns the persisted IDs and the React UI reloads the organization datasets after a successful response.

## React behavior

The Go React CRM back office provides lead creation, qualification, then conversion controls for authorized roles. Labels and validation messages support English and Traditional Chinese. Errors remain visible and form values remain intact after failures. Non-back-office and read-only users do not get mutation controls, while backend authorization remains authoritative.

## Acceptance

HTTP integration tests use the real Go handler and SQLite schema to cover create and qualification persistence, tenant/role/session denial, malicious identity fields, valid conversion persistence, wrong-stage/owner/date/amount rejection, repeated and concurrent conversion, and a forced late transactional failure proving rollback. Browser acceptance must exercise the Go-served CRM React screen against persisted records when an existing remote browser workflow is available. Remote CI is the test/build authority for this branch; local tests/builds are not part of this task.
