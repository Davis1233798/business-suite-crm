package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestCRMSLACalendarWeekendSkipAndBusinessHours(t *testing.T) {
	// Business hours: 09:00 - 18:00 UTC, Mon-Fri (weekends Saturday & Sunday skipped)

	// 1. Friday 15:00 UTC with 6-hour SLA
	// Friday 15:00 to 18:00 = 3 hours used
	// Saturday & Sunday skipped
	// Monday 09:00 to 12:00 = remaining 3 hours
	// Expected: Monday 12:00 UTC
	friday3pm, err := time.Parse(time.RFC3339, "2026-10-30T15:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	due1 := crmSLADueUTC(friday3pm, 6)
	if got := due1.Format(time.RFC3339); got != "2026-11-02T12:00:00Z" {
		t.Fatalf("Friday 15:00 + 6hr SLA expected 2026-11-02T12:00:00Z, got %s", got)
	}

	// 2. Weekend creation (Saturday 11:00 UTC) with 4-hour SLA
	// Skips remaining weekend, starts Monday 09:00 UTC
	// Expected: Monday 13:00 UTC
	saturday, _ := time.Parse(time.RFC3339, "2026-10-31T11:00:00Z")
	due2 := crmSLADueUTC(saturday, 4)
	if got := due2.Format(time.RFC3339); got != "2026-11-02T13:00:00Z" {
		t.Fatalf("Saturday + 4hr SLA expected 2026-11-02T13:00:00Z, got %s", got)
	}

	// 3. After-hours creation (Wednesday 19:30 UTC) with 5-hour SLA
	// Starts Thursday 09:00 UTC
	// Expected: Thursday 14:00 UTC
	wedAfterHours, _ := time.Parse(time.RFC3339, "2026-10-28T19:30:00Z")
	due3 := crmSLADueUTC(wedAfterHours, 5)
	if got := due3.Format(time.RFC3339); got != "2026-10-29T14:00:00Z" {
		t.Fatalf("Wednesday after-hours + 5hr SLA expected 2026-10-29T14:00:00Z, got %s", got)
	}

	// 4. Before-hours creation (Tuesday 06:15 UTC) with 3-hour SLA
	// Starts Tuesday 09:00 UTC
	// Expected: Tuesday 12:00 UTC
	tueBeforeHours, _ := time.Parse(time.RFC3339, "2026-10-27T06:15:00Z")
	due4 := crmSLADueUTC(tueBeforeHours, 3)
	if got := due4.Format(time.RFC3339); got != "2026-10-27T12:00:00Z" {
		t.Fatalf("Tuesday before-hours + 3hr SLA expected 2026-10-27T12:00:00Z, got %s", got)
	}

	// 5. Multi-day spanning weekend: Thursday 16:00 UTC with 15-hour SLA
	// Thursday: 16:00-18:00 (2 hrs used, 13 hrs remain)
	// Friday: 09:00-18:00 (9 hrs used, 4 hrs remain)
	// Sat & Sun: skipped
	// Monday: 09:00 + 4 hrs = 13:00 UTC
	// Expected: Monday 13:00 UTC
	thuMultiDay, _ := time.Parse(time.RFC3339, "2026-10-29T16:00:00Z")
	due5 := crmSLADueUTC(thuMultiDay, 15)
	if got := due5.Format(time.RFC3339); got != "2026-11-02T13:00:00Z" {
		t.Fatalf("Thursday 16:00 + 15hr SLA expected 2026-11-02T13:00:00Z, got %s", got)
	}
}

func TestCRMTicketPauseReopenAndSLAFreeze(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	office := loginSite(t, a, "office@suite.test", space, "crm")
	front := loginSite(t, a, "front@suite.test", space, "crm")
	viewer := loginSite(t, a, "viewer@suite.test", space, "crm")
	other := loginSite(t, a, "admin@suite.test", token(), "crm")

	path := "/api/stations/crm/support"

	var account string
	if err := a.db.QueryRow("SELECT id FROM crm_accounts WHERE organization_id=? LIMIT 1", org).Scan(&account); err != nil {
		t.Fatal(err)
	}

	// 1. Create ticket with SLA
	createReq := map[string]any{
		"action":         "ticket",
		"accountId":      account,
		"subject":        "Urgent server issue",
		"priority":       "urgent",
		"slaHours":       6,
		"idempotencyKey": "ticket-pause-test-01",
	}
	w := request(a, "POST", path, createReq, office...)
	if w.Code != 200 {
		t.Fatalf("create ticket failed: %d %s", w.Code, w.Body.String())
	}
	var tktRes struct {
		Data struct {
			TicketID string `json:"ticketId"`
			DueAt    string `json:"dueAt"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &tktRes)
	ticketID := tktRes.Data.TicketID
	if ticketID == "" {
		t.Fatalf("empty ticket ID: %s", w.Body.String())
	}

	// Override created_at and due_at to Friday 15:00 UTC for predictable pause/reopen calculation
	fri15 := "2026-10-30T15:00:00Z"
	mon12 := "2026-11-02T12:00:00Z"
	if _, err := a.db.Exec("UPDATE crm_tickets SET created_at=?, due_at=? WHERE id=?", fri15, mon12, ticketID); err != nil {
		t.Fatal(err)
	}

	// 2. Pause ticket authorization checks
	pauseReq := map[string]any{
		"action":         "pause-ticket",
		"ticketId":       ticketID,
		"reason":         "Waiting for client logs",
		"time":           "2026-10-30T17:00:00Z", // 2 working hours elapsed, 4 working hours remain
		"idempotencyKey": "pause-ticket-key-01",
	}

	// Unauthorized roles
	if resp := request(a, "POST", path, pauseReq, front...); resp.Code != 403 {
		t.Fatalf("front pause expected 403, got %d", resp.Code)
	}
	if resp := request(a, "POST", path, pauseReq, viewer...); resp.Code != 403 {
		t.Fatalf("viewer pause expected 403, got %d", resp.Code)
	}
	if resp := request(a, "POST", path, pauseReq, other...); resp.Code != 404 {
		t.Fatalf("cross-tenant pause expected 404, got %d", resp.Code)
	}

	// Authorized pause
	w = request(a, "POST", path, pauseReq, office...)
	if w.Code != 200 {
		t.Fatalf("pause ticket failed: %d %s", w.Code, w.Body.String())
	}
	var pauseResult struct {
		Data struct {
			Status              string `json:"status"`
			SlaRemainingSeconds int64  `json:"slaRemainingSeconds"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &pauseResult)
	if pauseResult.Data.Status != "pending_customer" {
		t.Fatalf("expected status pending_customer, got %s", pauseResult.Data.Status)
	}
	// 4 working hours = 14400 seconds
	if pauseResult.Data.SlaRemainingSeconds != 14400 {
		t.Fatalf("expected 14400 remaining seconds, got %d", pauseResult.Data.SlaRemainingSeconds)
	}

	// Idempotency replay of pause
	wReplay := request(a, "POST", path, pauseReq, office...)
	if wReplay.Code != 200 {
		t.Fatalf("pause replay expected 200, got %d", wReplay.Code)
	}

	// Check status in workspace data: ticket in pending_customer should NOT be breached
	dataResp := request(a, "GET", "/api/stations/crm/data?view=front", nil, front...)
	var dataSnapshot struct {
		Data struct {
			Tickets []struct {
				ID       string `json:"id"`
				Status   string `json:"status"`
				Breached bool   `json:"isSlaBreached"`
			} `json:"tickets"`
		} `json:"data"`
	}
	json.Unmarshal(dataResp.Body.Bytes(), &dataSnapshot)
	var foundPaused bool
	for _, tk := range dataSnapshot.Data.Tickets {
		if tk.ID == ticketID {
			foundPaused = true
			if tk.Status != "pending_customer" {
				t.Fatalf("ticket status in data view: %s", tk.Status)
			}
			if tk.Breached {
				t.Fatalf("ticket in pending_customer should not be breached")
			}
		}
	}
	if !foundPaused {
		t.Fatalf("paused ticket missing from front data")
	}

	// 3. Reopen ticket
	reopenReq := map[string]any{
		"action":         "reopen-ticket",
		"ticketId":       ticketID,
		"time":           "2026-11-03T10:00:00Z", // Tuesday 10:00 UTC
		"idempotencyKey": "reopen-ticket-key-01",
	}

	// Unauthorized roles
	if resp := request(a, "POST", path, reopenReq, front...); resp.Code != 403 {
		t.Fatalf("front reopen expected 403, got %d", resp.Code)
	}
	if resp := request(a, "POST", path, reopenReq, other...); resp.Code != 404 {
		t.Fatalf("cross-tenant reopen expected 404, got %d", resp.Code)
	}

	// Authorized reopen
	w = request(a, "POST", path, reopenReq, office...)
	if w.Code != 200 {
		t.Fatalf("reopen ticket failed: %d %s", w.Code, w.Body.String())
	}
	var reopenResult struct {
		Data struct {
			Status string `json:"status"`
			DueAt  string `json:"dueAt"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &reopenResult)
	if reopenResult.Data.Status != "open" {
		t.Fatalf("expected status open, got %s", reopenResult.Data.Status)
	}
	// Reopened Tuesday 10:00 UTC with 4 remaining hours -> Tuesday 14:00 UTC (2026-11-03T14:00:00Z)
	if reopenResult.Data.DueAt != "2026-11-03T14:00:00Z" {
		t.Fatalf("expected dueAt 2026-11-03T14:00:00Z, got %s", reopenResult.Data.DueAt)
	}

	// Idempotency replay of reopen
	if wReplay = request(a, "POST", path, reopenReq, office...); wReplay.Code != 200 {
		t.Fatalf("reopen replay expected 200, got %d", wReplay.Code)
	}
}

func TestCRMLeadDuplicateDetectionAndMerge(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	admin := loginSite(t, a, "admin@suite.test", space, "crm")
	operator := loginSite(t, a, "office@suite.test", space, "crm")
	front := loginSite(t, a, "front@suite.test", space, "crm")
	viewer := loginSite(t, a, "viewer@suite.test", space, "crm")
	other := loginSite(t, a, "admin@suite.test", token(), "crm")

	leadPath := "/api/stations/crm/leads"
	dupPath := "/api/stations/crm/lead-duplicates"
	mergePath := "/api/stations/crm/lead-merge"

	// 1. Create primary lead
	leadAData := map[string]any{
		"name":    "Alice Founder",
		"company": "Apex Dynamics",
		"email":   "alice@apex.test",
		"phone":   "+886-2-87654321",
		"taxId":   "12345678",
		"notes":   "Primary lead: met at Taipei tech expo.",
	}
	res, bodyA := crmLeadRequest(a, http.MethodPost, leadPath, leadAData, operator...)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create lead A failed: %d %#v", res.StatusCode, bodyA)
	}
	leadAID := bodyA["data"].(map[string]any)["id"].(string)

	// 2. Check duplicate detection before creating duplicate lead
	// By email
	checkReq := map[string]any{"email": "ALICE@apex.test"}
	w := request(a, "POST", dupPath, checkReq, operator...)
	if w.Code != 200 {
		t.Fatalf("duplicate check by email failed: %d %s", w.Code, w.Body.String())
	}
	var dupList struct {
		Data struct {
			Duplicates []struct {
				ID string `json:"id"`
			} `json:"duplicates"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &dupList)
	if len(dupList.Data.Duplicates) != 1 || dupList.Data.Duplicates[0].ID != leadAID {
		t.Fatalf("expected duplicate leadA, got %#v", dupList)
	}

	// By Tax ID
	checkReq = map[string]any{"taxId": "12345678"}
	w = request(a, "POST", dupPath, checkReq, operator...)
	json.Unmarshal(w.Body.Bytes(), &dupList)
	if len(dupList.Data.Duplicates) != 1 || dupList.Data.Duplicates[0].ID != leadAID {
		t.Fatalf("expected duplicate leadA by taxId, got %#v", dupList)
	}

	// 3. Create duplicate lead B with same company and phone
	leadBData := map[string]any{
		"name":    "Alice F.",
		"company": "Apex Dynamics Taiwan",
		"email":   "alice.dup@apex.test",
		"phone":   "+886-2-87654321",
		"taxId":   "12345678",
		"notes":   "Duplicate lead: inbound web form submission.",
	}
	res, bodyB := crmLeadRequest(a, http.MethodPost, leadPath, leadBData, operator...)
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create lead B failed: %d %#v", res.StatusCode, bodyB)
	}
	leadBID := bodyB["data"].(map[string]any)["id"].(string)

	// Add an activity associated with lead B
	actID := "act_" + token()
	if _, err := a.db.Exec("INSERT INTO crm_activities(id,organization_id,activity_type,subject,due_date,owner_id,lead_id) VALUES(?,?,?,?,?,?,?)",
		actID, org, "call", "Follow-up phone call with Alice", "2026-11-05T10:00:00Z", "office@suite.test", leadBID); err != nil {
		t.Fatal(err)
	}

	// 4. Test Lead Merge
	mergeReq := map[string]any{
		"primaryLeadId":   leadAID,
		"duplicateLeadId": leadBID,
		"idempotencyKey":  "merge-leads-key-01",
	}

	// Denial tests
	if r, _ := crmLeadRequest(a, http.MethodPost, mergePath, mergeReq, front...); r.StatusCode != http.StatusForbidden {
		t.Fatalf("front merge expected 403, got %d", r.StatusCode)
	}
	if r, _ := crmLeadRequest(a, http.MethodPost, mergePath, mergeReq, viewer...); r.StatusCode != http.StatusForbidden {
		t.Fatalf("viewer merge expected 403, got %d", r.StatusCode)
	}
	if r, _ := crmLeadRequest(a, http.MethodPost, mergePath, mergeReq, other...); r.StatusCode != http.StatusNotFound {
		t.Fatalf("cross-tenant merge expected 404, got %d", r.StatusCode)
	}

	// Successful merge by operator or admin
	r, mergeResp := crmLeadRequest(a, http.MethodPost, mergePath, mergeReq, admin...)
	if r.StatusCode != http.StatusOK {
		t.Fatalf("admin merge failed: %d %#v", r.StatusCode, mergeResp)
	}

	// Verify state after merge:
	// a) Lead B status is 'merged' and merged_into_id is Lead A
	var statusB, mergedInto string
	if err := a.db.QueryRow("SELECT status, merged_into_id FROM crm_leads WHERE id=?", leadBID).Scan(&statusB, &mergedInto); err != nil {
		t.Fatal(err)
	}
	if statusB != "merged" || mergedInto != leadAID {
		t.Fatalf("lead B not marked merged: status=%s, mergedInto=%s", statusB, mergedInto)
	}

	// b) Lead A has migrated notes from Lead B
	var notesA string
	if err := a.db.QueryRow("SELECT notes FROM crm_leads WHERE id=?", leadAID).Scan(&notesA); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(notesA, "Primary lead: met at Taipei tech expo.") || !strings.Contains(notesA, "Duplicate lead: inbound web form submission.") {
		t.Fatalf("notes were not safely concatenated: %s", notesA)
	}

	// c) Activity was re-linked to Lead A
	var activityLeadID string
	if err := a.db.QueryRow("SELECT lead_id FROM crm_activities WHERE id=?", actID).Scan(&activityLeadID); err != nil {
		t.Fatal(err)
	}
	if activityLeadID != leadAID {
		t.Fatalf("activity was not migrated to lead A: got %s", activityLeadID)
	}

	// 5. Duplicate conversion prevention:
	// Attempting to qualify or convert the merged Lead B must conflict / fail!
	if r, _ = crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-qualify", map[string]any{"leadId": leadBID}, operator...); r.StatusCode != http.StatusConflict {
		t.Fatalf("qualifying merged lead expected 409, got %d", r.StatusCode)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-convert", map[string]any{"leadId": leadBID, "amount": 50000, "closeDate": "2027-01-01"}, operator...); r.StatusCode != http.StatusConflict {
		t.Fatalf("converting merged lead expected 409, got %d", r.StatusCode)
	}

	// 6. Primary Lead A can still be qualified and converted normally
	if r, _ = crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-qualify", map[string]any{"leadId": leadAID}, operator...); r.StatusCode != http.StatusOK {
		t.Fatalf("qualifying primary lead A failed: %d", r.StatusCode)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-convert", map[string]any{"leadId": leadAID, "amount": 90000, "closeDate": "2027-05-01"}, operator...); r.StatusCode != http.StatusOK {
		t.Fatalf("converting primary lead A failed: %d", r.StatusCode)
	}

	// Replay merge key: idempotent replay returns HTTP 200
	if r, _ = crmLeadRequest(a, http.MethodPost, mergePath, mergeReq, operator...); r.StatusCode != http.StatusOK {
		t.Fatalf("merge idempotency replay failed: %d", r.StatusCode)
	}
}

func TestCRMMarketingConsentRevocationImmediateExclusion(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	office := loginSite(t, a, "office@suite.test", space, "crm")
	front := loginSite(t, a, "front@suite.test", space, "crm")
	other := loginSite(t, a, "admin@suite.test", token(), "crm")

	path := "/api/stations/crm/support"

	// 1. Create a contact with marketing consent opted in
	optInReq := map[string]any{
		"action":           "contact",
		"name":             "Consent Holder",
		"email":            "privacy.user@company.test",
		"phone":            "0988000111",
		"title":            "Director",
		"marketingConsent": true,
		"idempotencyKey":   "consent-create-key-01",
	}
	w := request(a, "POST", path, optInReq, office...)
	if w.Code != 200 {
		t.Fatalf("create contact with consent failed: %d %s", w.Code, w.Body.String())
	}
	var res struct {
		Data struct {
			ContactID string `json:"contactId"`
		} `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &res)
	contactID := res.Data.ContactID
	if contactID == "" {
		t.Fatalf("missing contact ID: %s", w.Body.String())
	}

	// Verify contact appears in marketing recipients list
	back := request(a, "GET", "/api/stations/crm/data?view=back", nil, office...)
	var snapshot struct {
		Data struct {
			MarketingRecipients []struct {
				ContactID string `json:"contactId"`
				Email     string `json:"email"`
			} `json:"marketingRecipients"`
		} `json:"data"`
	}
	json.Unmarshal(back.Body.Bytes(), &snapshot)
	var found bool
	for _, rec := range snapshot.Data.MarketingRecipients {
		if rec.Email == "privacy.user@company.test" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected privacy.user@company.test in marketing recipients before revocation")
	}

	// 2. Revoke consent by email or contact ID
	revokeReq := map[string]any{
		"action":         "revoke",
		"email":          "privacy.user@company.test",
		"contactId":      contactID,
		"idempotencyKey": "revoke-consent-key-01",
	}

	// Denial tests
	if w := request(a, "POST", path, revokeReq, front...); w.Code != 403 {
		t.Fatalf("front revoke expected 403, got %d", w.Code)
	}
	if w := request(a, "POST", path, revokeReq, other...); w.Code != 404 {
		t.Fatalf("cross-tenant revoke expected 404, got %d", w.Code)
	}

	// Authorized revocation
	w = request(a, "POST", path, revokeReq, office...)
	if w.Code != 200 {
		t.Fatalf("revocation failed: %d %s", w.Code, w.Body.String())
	}

	// 3. Immediate exclusion verification
	// Database check: marketing_email_allowed = 0
	var allowed int
	if err := a.db.QueryRow("SELECT marketing_email_allowed FROM crm_consents WHERE organization_id=? AND contact_id=?", org, contactID).Scan(&allowed); err != nil {
		t.Fatal(err)
	}
	if allowed != 0 {
		t.Fatalf("consent was not updated in database: %d", allowed)
	}

	// Immediate query exclusion
	backAfter := request(a, "GET", "/api/stations/crm/data?view=back", nil, office...)
	snapshot.Data.MarketingRecipients = nil
	json.Unmarshal(backAfter.Body.Bytes(), &snapshot)
	for _, rec := range snapshot.Data.MarketingRecipients {
		if rec.Email == "privacy.user@company.test" {
			t.Fatalf("revoked contact is still present in marketingRecipients after revocation!")
		}
	}

	// Marketing export exclusion check
	exportResp := request(a, "GET", "/api/stations/crm/marketing-export", nil, office...)
	if exportResp.Code == 200 {
		if strings.Contains(exportResp.Body.String(), "privacy.user@company.test") {
			t.Fatalf("revoked contact leaked into marketing export!")
		}
	}
}
