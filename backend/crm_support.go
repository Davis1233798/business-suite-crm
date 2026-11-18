package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
)

// SLA calculation supporting customizable time zone, working hours 09:00 - 18:00, Monday through Friday; weekends (Sat/Sun) skipped.
func crmSLADueWithZone(start time.Time, hours int, zone *time.Location) time.Time {
	current := start.In(zone)
	remaining := time.Duration(hours) * time.Hour
	for remaining > 0 {
		day := current.Weekday()
		if day == time.Saturday || day == time.Sunday {
			days := 1
			if day == time.Saturday {
				days = 2
			}
			next := current.AddDate(0, 0, days)
			current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
			continue
		}
		begin := time.Date(current.Year(), current.Month(), current.Day(), 9, 0, 0, 0, zone)
		end := time.Date(current.Year(), current.Month(), current.Day(), 18, 0, 0, 0, zone)
		if current.Before(begin) {
			current = begin
			continue
		}
		if !current.Before(end) {
			next := current.AddDate(0, 0, 1)
			current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
			continue
		}
		available := end.Sub(current)
		if remaining <= available {
			current = current.Add(remaining)
			break
		}
		remaining -= available
		next := current.AddDate(0, 0, 1)
		current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
	}
	return current.UTC()
}

// SLA uses Taipei business hours, Monday through Friday; public holidays are not excluded.
func crmSLADue(start time.Time, hours int) time.Time {
	return crmSLADueWithZone(start, hours, time.FixedZone("Asia/Taipei", 8*60*60))
}

// SLA uses UTC business hours (09:00 - 18:00 UTC), Monday through Friday; weekends skipped.
func crmSLADueUTC(start time.Time, hours int) time.Time {
	return crmSLADueWithZone(start, hours, time.UTC)
}

// crmSLARemainingWorkingSeconds calculates working seconds remaining between now and due date in the given zone.
func crmSLARemainingWorkingSeconds(now, due time.Time, zone *time.Location) int64 {
	if !now.Before(due) {
		return 0
	}
	current := now.In(zone)
	target := due.In(zone)
	var totalSeconds int64

	for current.Before(target) {
		day := current.Weekday()
		if day == time.Saturday || day == time.Sunday {
			days := 1
			if day == time.Saturday {
				days = 2
			}
			next := current.AddDate(0, 0, days)
			current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
			continue
		}
		begin := time.Date(current.Year(), current.Month(), current.Day(), 9, 0, 0, 0, zone)
		end := time.Date(current.Year(), current.Month(), current.Day(), 18, 0, 0, 0, zone)

		if current.Before(begin) {
			current = begin
			continue
		}
		if !current.Before(end) {
			next := current.AddDate(0, 0, 1)
			current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
			continue
		}
		windowEnd := end
		if target.Before(windowEnd) {
			windowEnd = target
		}
		dur := windowEnd.Sub(current)
		if dur > 0 {
			totalSeconds += int64(dur.Seconds())
		}
		current = end
		next := current.AddDate(0, 0, 1)
		current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
	}
	return totalSeconds
}

// crmSLAAddWorkingDuration adds working seconds to start time within 09:00 - 18:00 business hours, skipping weekends.
func crmSLAAddWorkingDuration(start time.Time, seconds int64, zone *time.Location) time.Time {
	current := start.In(zone)
	remaining := time.Duration(seconds) * time.Second
	for remaining > 0 {
		day := current.Weekday()
		if day == time.Saturday || day == time.Sunday {
			days := 1
			if day == time.Saturday {
				days = 2
			}
			next := current.AddDate(0, 0, days)
			current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
			continue
		}
		begin := time.Date(current.Year(), current.Month(), current.Day(), 9, 0, 0, 0, zone)
		end := time.Date(current.Year(), current.Month(), current.Day(), 18, 0, 0, 0, zone)
		if current.Before(begin) {
			current = begin
			continue
		}
		if !current.Before(end) {
			next := current.AddDate(0, 0, 1)
			current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
			continue
		}
		available := end.Sub(current)
		if remaining <= available {
			current = current.Add(remaining)
			break
		}
		remaining -= available
		next := current.AddDate(0, 0, 1)
		current = time.Date(next.Year(), next.Month(), next.Day(), 9, 0, 0, 0, zone)
	}
	return current.UTC()
}

type crmSupportRequest struct {
	Action    string `json:"action"`
	AccountID string `json:"accountId"`
	ContactID string `json:"contactId"`
	TicketID  string `json:"ticketId"`
	Reason    string `json:"reason"`
	Time      string `json:"time"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Phone     string `json:"phone"`
	Title     string `json:"title"`
	Consent   bool   `json:"marketingConsent"`
	Subject   string `json:"subject"`
	Priority  string `json:"priority"`
	SLAHours  int    `json:"slaHours"`
	Key       string `json:"idempotencyKey"`
}

func (a *App) crmSupport(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if g.Role == "readonly" || g.Scope != "back" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var in crmSupportRequest
	if body(r, &in) != nil || len(in.Key) < 8 || len(in.Key) > 128 || len(in.AccountID) > 256 || len(in.ContactID) > 256 || (in.Action != "contact" && in.Action != "revoke" && in.Action != "ticket" && in.Action != "pause-ticket" && in.Action != "reopen-ticket") {
		fail(w, 400, "Invalid CRM request")
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	in.Phone = strings.TrimSpace(in.Phone)
	in.Title = strings.TrimSpace(in.Title)
	in.Subject = strings.TrimSpace(in.Subject)
	in.TicketID = strings.TrimSpace(in.TicketID)
	in.Reason = strings.TrimSpace(in.Reason)

	if in.Action == "contact" {
		address, e := mail.ParseAddress(in.Email)
		if e != nil || address.Address != in.Email || len(in.Email) > 254 || len(in.Name) == 0 || len(in.Name) > 150 || len(in.Phone) > 30 || len(in.Title) > 120 {
			fail(w, 400, "Enter valid contact details")
			return
		}
	}
	if in.Action == "revoke" && in.ContactID == "" && in.Email == "" {
		fail(w, 400, "Select a contact or specify email")
		return
	}
	if in.Action == "ticket" && (len(in.Subject) == 0 || len(in.Subject) > 300 || in.SLAHours < 1 || in.SLAHours > 720 || (in.Priority != "low" && in.Priority != "medium" && in.Priority != "high" && in.Priority != "urgent")) {
		fail(w, 400, "Enter valid support ticket details")
		return
	}
	if (in.Action == "pause-ticket" || in.Action == "reopen-ticket") && in.TicketID == "" {
		fail(w, 400, "Ticket ID is required")
		return
	}

	tx, e := a.db.BeginTx(r.Context(), nil)
	if e != nil {
		fail(w, 503, "CRM unavailable")
		return
	}
	defer tx.Rollback()
	raw, _ := json.Marshal(in)
	hash := digest(id.UserID + "\x00" + string(raw))
	endpoint := "/station/crm/support/" + in.Action
	var oldHash, oldBody string
	e = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, in.Key, endpoint).Scan(&oldHash, &oldBody)
	if e == nil {
		if hash != oldHash {
			fail(w, 409, "Retry key already used")
			return
		}
		var result map[string]any
		if json.Unmarshal([]byte(oldBody), &result) != nil {
			fail(w, 500, "Invalid retry result")
			return
		}
		ok(w, result)
		return
	}
	if !errors.Is(e, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}
	result := map[string]any{}
	entity := ""
	if in.AccountID != "" {
		var count int
		e = tx.QueryRow("SELECT count(*) FROM crm_accounts WHERE organization_id=? AND id=?", id.OrganizationID, in.AccountID).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot validate customer")
			return
		}
		if count != 1 {
			fail(w, 404, "Customer not found")
			return
		}
	}
	switch in.Action {
	case "contact":
		var count int
		e = tx.QueryRow("SELECT count(*) FROM crm_contacts WHERE organization_id=? AND lower(email)=?", id.OrganizationID, in.Email).Scan(&count)
		if e != nil {
			fail(w, 503, "Cannot check contact")
			return
		}
		if count > 0 {
			fail(w, 409, "A contact with this email already exists")
			return
		}
		entity = "contact_" + token()
		var account any = nil
		if in.AccountID != "" {
			account = in.AccountID
		}
		_, e = tx.Exec("INSERT INTO crm_contacts(id,organization_id,account_id,name,email,phone,title) VALUES(?,?,?,?,?,?,?)", entity, id.OrganizationID, account, in.Name, in.Email, in.Phone, in.Title)
		allowed := 0
		if in.Consent {
			allowed = 1
		}
		if e == nil {
			_, e = tx.Exec("INSERT INTO crm_consents(id,organization_id,contact_id,email,marketing_email_allowed,status) VALUES(?,?,?,?,?,?)", "consent_"+token(), id.OrganizationID, entity, in.Email, allowed, "active")
		}
		result["contactId"] = entity
	case "revoke":
		if in.ContactID != "" {
			entity = in.ContactID
			var count int
			e = tx.QueryRow("SELECT count(*) FROM crm_contacts WHERE organization_id=? AND id=?", id.OrganizationID, entity).Scan(&count)
			if e != nil {
				fail(w, 503, "Cannot read contact")
				return
			}
			if count == 0 {
				fail(w, 404, "Contact not found")
				return
			}
			_, e = tx.Exec("UPDATE crm_consents SET marketing_email_allowed=0,status='revoked',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND contact_id=?", id.OrganizationID, entity)
		} else if in.Email != "" {
			entity = in.Email
			var count int
			e = tx.QueryRow("SELECT count(*) FROM crm_contacts WHERE organization_id=? AND lower(email)=?", id.OrganizationID, in.Email).Scan(&count)
			if e != nil {
				fail(w, 503, "Cannot read contact")
				return
			}
			if count == 0 {
				fail(w, 404, "Contact not found")
				return
			}
			_, e = tx.Exec("UPDATE crm_consents SET marketing_email_allowed=0,status='revoked',revoked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE organization_id=? AND lower(email)=?", id.OrganizationID, in.Email)
		}
		result["marketingConsent"] = false
	case "ticket":
		if in.ContactID != "" {
			var count int
			e = tx.QueryRow("SELECT count(*) FROM crm_contacts WHERE organization_id=? AND id=? AND (?='' OR account_id=?)", id.OrganizationID, in.ContactID, in.AccountID, in.AccountID).Scan(&count)
			if e != nil {
				fail(w, 503, "Cannot validate contact")
				return
			}
			if count != 1 {
				fail(w, 404, "Contact not found for this customer")
				return
			}
		}
		entity = "ticket_" + token()
		number := "TCK-" + strings.ToUpper(token()[:12])
		created := time.Now().UTC()
		due := crmSLADue(created, in.SLAHours)
		var account, contact any = nil, nil
		if in.AccountID != "" {
			account = in.AccountID
		}
		if in.ContactID != "" {
			contact = in.ContactID
		}
		_, e = tx.Exec("INSERT INTO crm_tickets(id,organization_id,ticket_number,customer_id,contact_id,subject,priority,status,sla_hours,is_sla_breached,due_at,created_at) VALUES(?,?,?,?,?,?,?,'new',?,0,?,?)", entity, id.OrganizationID, number, account, contact, in.Subject, in.Priority, in.SLAHours, due.Format(time.RFC3339), created.Format(time.RFC3339))
		result = map[string]any{"ticketId": entity, "ticketNumber": number, "dueAt": due.Format(time.RFC3339)}
	case "pause-ticket":
		entity = in.TicketID
		var status string
		var createdAtStr, dueAtStr sql.NullString
		var slaHours int
		var pausedAtStr sql.NullString
		var existingRemaining sql.NullInt64
		e = tx.QueryRow("SELECT status, created_at, due_at, sla_hours, paused_at, sla_remaining_seconds FROM crm_tickets WHERE organization_id=? AND id=?", id.OrganizationID, entity).Scan(&status, &createdAtStr, &dueAtStr, &slaHours, &pausedAtStr, &existingRemaining)
		if e != nil {
			if errors.Is(e, sql.ErrNoRows) {
				fail(w, 404, "Ticket not found")
				return
			}
			fail(w, 503, "Cannot read ticket")
			return
		}
		if status == "pending_customer" {
			rem := int64(0)
			if existingRemaining.Valid {
				rem = existingRemaining.Int64
			}
			result = map[string]any{"ticketId": entity, "status": "pending_customer", "slaRemainingSeconds": rem}
			break
		}
		if status == "resolved" || status == "closed" {
			fail(w, 409, "Resolved or closed tickets cannot be paused")
			return
		}
		pauseTime := time.Now().UTC()
		if in.Time != "" {
			if pt, err := time.Parse(time.RFC3339, in.Time); err == nil {
				pauseTime = pt.UTC()
			}
		}
		var dueTime time.Time
		if dueAtStr.Valid && dueAtStr.String != "" {
			dueTime, _ = time.Parse(time.RFC3339, dueAtStr.String)
		}
		if dueTime.IsZero() && createdAtStr.Valid && createdAtStr.String != "" {
			if ct, err := time.Parse(time.RFC3339, createdAtStr.String); err == nil {
				dueTime = crmSLADueUTC(ct, slaHours)
			}
		}
		if dueTime.IsZero() {
			dueTime = crmSLADueUTC(pauseTime, slaHours)
		}
		remSeconds := crmSLARemainingWorkingSeconds(pauseTime, dueTime, time.UTC)
		_, e = tx.Exec("UPDATE crm_tickets SET status='pending_customer', paused_at=?, sla_remaining_seconds=? WHERE organization_id=? AND id=?", pauseTime.Format(time.RFC3339), remSeconds, id.OrganizationID, entity)
		result = map[string]any{"ticketId": entity, "status": "pending_customer", "slaRemainingSeconds": remSeconds}
	case "reopen-ticket":
		entity = in.TicketID
		var status string
		var slaHours int
		var pausedAtStr sql.NullString
		var remSeconds sql.NullInt64
		e = tx.QueryRow("SELECT status, sla_hours, paused_at, sla_remaining_seconds FROM crm_tickets WHERE organization_id=? AND id=?", id.OrganizationID, entity).Scan(&status, &slaHours, &pausedAtStr, &remSeconds)
		if e != nil {
			if errors.Is(e, sql.ErrNoRows) {
				fail(w, 404, "Ticket not found")
				return
			}
			fail(w, 503, "Cannot read ticket")
			return
		}
		if status != "pending_customer" {
			fail(w, 409, "Ticket is not paused")
			return
		}
		reopenTime := time.Now().UTC()
		if in.Time != "" {
			if rt, err := time.Parse(time.RFC3339, in.Time); err == nil {
				reopenTime = rt.UTC()
			}
		}
		secondsToApply := int64(slaHours * 3600)
		if remSeconds.Valid && remSeconds.Int64 > 0 {
			secondsToApply = remSeconds.Int64
		}
		newDue := crmSLAAddWorkingDuration(reopenTime, secondsToApply, time.UTC)
		_, e = tx.Exec("UPDATE crm_tickets SET status='open', paused_at=NULL, sla_remaining_seconds=NULL, due_at=? WHERE organization_id=? AND id=?", newDue.Format(time.RFC3339), id.OrganizationID, entity)
		result = map[string]any{"ticketId": entity, "status": "open", "dueAt": newDue.Format(time.RFC3339)}
	}
	if e != nil {
		fail(w, 503, "Cannot save CRM operation")
		return
	}
	encoded, _ := json.Marshal(result)
	_, e = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, in.Key, endpoint, hash, string(encoded))
	if e == nil {
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'crm',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "crm.support."+in.Action, entity, string(encoded))
	}
	if e != nil {
		fail(w, 503, "Cannot record CRM operation")
		return
	}
	if tx.Commit() != nil {
		fail(w, 503, "Cannot commit CRM operation")
		return
	}
	ok(w, result)
}
