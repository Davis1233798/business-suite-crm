# Standalone CRM support workflow

The back office owns contact registration, marketing consent and revocation,
and support ticket creation. Writes are scoped to the signed-in organization.
Ticket contacts must belong to the selected customer. The API records audit
and retry state in the business transaction and calculates the SLA deadline.

GitHub CI verifies the Go integration contract for these workflows.
