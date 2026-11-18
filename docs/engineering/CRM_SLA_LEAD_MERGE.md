# CRM P1: Support Ticket SLA Calendar, Lead Duplicate Merge, and Marketing Consent Revocation

## 1. Overview & System Boundaries

This specification defines the P1 core operational invariants for CRM (RelationDesk), implemented within the independent Go + SQLite service and its React/HTTP boundaries:

1. **Customer Service SLA Calendar Calculation (R06)**:
   - Operating hours are defined as 09:00 - 18:00 UTC Monday through Friday.
   - Weekends (Saturday and Sunday) are strictly skipped in target deadline calculations.
   - For example, a ticket created at Friday 15:00 UTC with a 6-hour SLA consumes 3 working hours on Friday (15:00 to 18:00 UTC), skips Saturday and Sunday, and uses the remaining 3 working hours on Monday (09:00 to 12:00 UTC), reaching due date Monday 12:00 UTC.
   - Support tickets can be paused (`pending_customer`), freezing the SLA countdown and recording the remaining working time. Upon reopening, the deadline is recalculated from the reopen timestamp using the frozen remaining SLA working duration.

2. **Lead Duplicate Detection & Merge Approval**:
   - Automated duplicate detection checks against existing leads in the same organization by matching email (case-insensitive), phone number, or unified business tax ID (`tax_id` / 統一編號).
   - An authorized merge API (`/api/stations/crm/lead-merge`) allows back-office operators or administrators to merge duplicate leads into a primary lead within an atomic database transaction.
   - Activity history and notes are securely migrated to the primary lead. The duplicate lead is transitioned to `merged` status and references the primary lead (`merged_into_id`), permanently barring qualification or conversion to prevent multiple accounts/contacts/opportunities.

3. **Marketing Consent Revocation (GDPR / Privacy Compliance)**:
   - Contact marketing consent tracking enforces immediate exclusion upon revocation (`marketing_email_allowed = 0` and status `revoked`).
   - Revocation can be triggered by contact ID or email address.
   - Any query or export of marketing recipients (`/api/stations/crm/data` or marketing export endpoint) strictly filters out revoked contacts in real time.

---

## 2. State Machines & Invariants

### 2.1 Support Ticket State Machine & SLA Freezing
```
           +--------------+
           |     new      |
           +-------+------+
                   |
                   v
           +--------------+      pause-ticket
           | open / active| -------------------> +------------------+
           +-------+------+                      | pending_customer |
                   ^                             |  (SLA frozen)    |
                   |       reopen-ticket         +--------+---------+
                   +--------------------------------------+
                   |
                   v
           +--------------+
           |   resolved   |
           +--------------+
```
- **Active state (`new`, `open`, `in_progress`)**:
  - SLA counts down during UTC business hours (09:00 - 18:00, Mon-Fri).
  - Breached status is evaluated dynamically: `is_sla_breached = (status != 'resolved' && status != 'pending_customer' && now > due_at)`.
- **Paused state (`pending_customer`)**:
  - `paused_at` records the exact pause timestamp.
  - `sla_remaining_seconds` freezes the remaining working seconds before breach.
  - `is_sla_breached` is frozen as `false` while in `pending_customer`.
- **Reopen transition (`reopen-ticket`)**:
  - Reopened ticket resumes with `sla_remaining_seconds` applied from the reopen time.
  - `new_due_at = addWorkingDuration(reopen_time, sla_remaining_seconds)`.
  - `paused_at` and `sla_remaining_seconds` are cleared.

### 2.2 Lead Lifecycle & Merge State Machine
```
           +--------------+       merge        +--------------+
           |     new      | -----------------> |    merged    |
           +-------+------+                    | (discarded,  |
                   | qualify                   |  read-only)  |
                   v                           +--------------+
           +--------------+       merge               ^
           |  qualified   | --------------------------+
           +-------+------+
                   | convert
                   v
           +--------------+
           |  converted   | (Cannot be merged or re-converted)
           +--------------+
```
- A lead with status `merged` cannot be qualified or converted.
- Calling `lead-qualify` or `lead-convert` on a `merged` lead immediately returns HTTP 409 Conflict.
- Conversion creates exactly one account, contact, and opportunity for the primary lead only.

---

## 3. Transaction Boundaries & Atomicity

### 3.1 Lead Merge Transaction
```
BEGIN TRANSACTION;
  1. Lock and fetch primary lead and duplicate lead WHERE organization_id = session.org_id.
  2. Validate:
     - Both leads exist in the tenant.
     - primaryLeadId != duplicateLeadId.
     - Neither lead has status = 'merged'.
     - Neither lead has status = 'converted'.
  3. Migrate activities:
     UPDATE crm_activities SET lead_id = primaryLeadId WHERE organization_id = session.org_id AND lead_id = duplicateLeadId;
  4. Migrate notes:
     UPDATE crm_leads SET notes = combined_notes WHERE organization_id = session.org_id AND id = primaryLeadId;
  5. Mark duplicate as merged:
     UPDATE crm_leads SET status = 'merged', merged_into_id = primaryLeadId WHERE organization_id = session.org_id AND id = duplicateLeadId;
  6. Insert audit event (action = 'crm.lead.merge', entity_id = primaryLeadId).
  7. Insert idempotency key.
COMMIT;
```
If any error occurs, the entire transaction rolls back. Neither lead changes status and no activities are orphaned.

### 3.2 Ticket Pause / Reopen Transaction
```
BEGIN TRANSACTION;
  1. Lock ticket WHERE organization_id = session.org_id AND id = ticketId.
  2. For pause:
     - Validate status IN ('new', 'open', 'in_progress').
     - Compute remaining working duration from now until due_at.
     - UPDATE crm_tickets SET status = 'pending_customer', paused_at = now, sla_remaining_seconds = remaining.
  3. For reopen:
     - Validate status = 'pending_customer'.
     - Calculate new due_at = crmSLADueWithCalendar(now, remainingDuration).
     - UPDATE crm_tickets SET status = 'open', paused_at = NULL, due_at = new_due_at, sla_remaining_seconds = NULL.
  4. Insert audit event and idempotency key.
COMMIT;
```

---

## 4. Multi-Tenant Isolation & Role Authorization

- **Tenant Isolation**: Every query and update binds `WHERE organization_id = ?`. Cross-tenant merges, ticket mutations, or consent lookups return HTTP 404 or HTTP 403, never leaking foreign entity presence.
- **Role Authorization**:
  - `operator` and `admin` with `scope = 'back'` possess mutation rights for tickets, lead merges, and consent management.
  - `readonly` or `front` grants are strictly denied (HTTP 403 Forbidden).
  - Client request bodies are stripped of `organizationId` or `userId`; identities are resolved exclusively from validated server sessions.

---

## 5. Rollback & Idempotency Guarantees

- **Idempotency Keys**: All state-modifying actions require an `idempotencyKey` (8-128 characters).
  - Exact replays return the cached HTTP 200 JSON response.
  - Replays with altered payloads or actors return HTTP 409 Conflict.
- **Failures & Rollback**:
  - Injected database failures or validation violations trigger `tx.Rollback()`.
  - Partial mutations (e.g. activities transferred without lead status update) are mathematically prevented by single-transaction boundaries.
