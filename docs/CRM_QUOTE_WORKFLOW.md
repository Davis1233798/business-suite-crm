# Standalone CRM quote lifecycle

The CRM back office owns quote creation and approval. The quote API resolves the
opportunity in the signed-in organization, allows the owner or an administrator
to submit a version, and reserves approval for administrators. Approval locks the
submitted snapshot. Subsequent changes create a new version. The transaction
stores the audit event and the retry result with the business write.

GitHub CI runs the Go integration contract for role and tenant boundaries,
concurrent version allocation, replay and approval. Existing quote printing reads
the same persisted records.
