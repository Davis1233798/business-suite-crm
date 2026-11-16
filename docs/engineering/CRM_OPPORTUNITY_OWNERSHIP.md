# CRM opportunity ownership boundary

## Contract

CRM opportunity ownership is enforced by the Go API using the authenticated
session's organization and user IDs. Those identifiers come from the server
session; request parameters and client-side filtering are not authorization.

- CRM administrators may read and update opportunities across their
  organization.
- Other back-office roles may read only opportunities whose `owner_id` matches
  their authenticated user. They may change stages only for those same
  opportunities and only when their grant permits writes.
- Quote headers and quote items inherit visibility from their linked
  opportunity. A quote's creator does not widen access to another owner's
  opportunity. Quote creation checks ownership before returning a cached retry
  result, so reassignment also revokes access to prior response data.
- Activities owned by the current user are visible only when they are not
  linked to an opportunity or are linked to an opportunity the user owns.
- All scoped queries remain constrained to the authenticated organization.

This boundary applies to the CRM dataset API, opportunity stage mutation, and
the quote print endpoint (including its line items). It does not change the
existing organization-wide customer/contact directory, pipeline stage
definitions, support workflow, marketing-recipient listing, account
administration, or front-office projections. This slice adds no schema
migration and does not read, alter, migrate, or publish any live database.

## Verification

Go API tests exercise administrator team access, operator own-record access and
denial for a colleague's opportunity and linked rows, read-only and front-office
role behavior, and cross-organization isolation. Rejected stage changes must
leave the opportunity, audit log, and idempotency state unchanged. Concurrency
and reassignment replay tests use separate `database/sql` handles against the
same temporary SQLite file, in one Go process. They do not establish behavior
for independent OS processes or the packaged Windows lifecycle.
