# Standalone CRM support workflow

The back office owns contact registration, marketing consent and revocation,
and support ticket creation. Writes are scoped to the signed-in organization.
The ticket form offers only contacts linked to the selected customer and clears the selection when that customer changes. The API independently verifies the relationship. The API records audit
and retry state in the business transaction and calculates the SLA deadline.

GitHub CI verifies the Go integration contract for these workflows.
