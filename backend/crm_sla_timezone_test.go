package main

import (
	"encoding/json"
	"testing"
	"time"
)

// TestCRMSLATaipeiCalendarWeekendAndBoundaries verifies SLA due calculation
// adhering to Asia/Taipei (UTC+8) business hours (09:00 - 18:00, Mon-Fri).
func TestCRMSLATaipeiCalendarWeekendAndBoundaries(t *testing.T) {
	// 1. Friday 15:00 Taipei (07:00 UTC) with 6-hour SLA
	// Friday 15:00 to 18:00 = 3 hours used
	// Saturday & Sunday skipped
	// Monday 09:00 to 12:00 = remaining 3 hours
	// Expected: Monday 12:00 Taipei (04:00 UTC)
	fri15Taipei, err := time.Parse(time.RFC3339, "2026-10-30T07:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	due1 := crmSLADue(fri15Taipei, 6)
	if got := due1.Format(time.RFC3339); got != "2026-11-02T04:00:00Z" {
		t.Fatalf("Friday 15:00 Taipei + 6hr SLA expected 2026-11-02T04:00:00Z, got %s", got)
	}

	// 2. Weekend creation (Saturday 11:00 Taipei = 03:00 UTC) with 4-hour SLA
	// Skips remaining weekend, starts Monday 09:00 Taipei (01:00 UTC)
	// Expected: Monday 13:00 Taipei (05:00 UTC)
	sat11Taipei, _ := time.Parse(time.RFC3339, "2026-10-31T03:00:00Z")
	due2 := crmSLADue(sat11Taipei, 4)
	if got := due2.Format(time.RFC3339); got != "2026-11-02T05:00:00Z" {
		t.Fatalf("Saturday 11:00 Taipei + 4hr SLA expected 2026-11-02T05:00:00Z, got %s", got)
	}

	// 3. Weekend creation (Sunday 16:30 Taipei = 08:30 UTC) with 5-hour SLA
	// Skips Sunday, starts Monday 09:00 Taipei (01:00 UTC)
	// Expected: Monday 14:00 Taipei (06:00 UTC)
	sun16Taipei, _ := time.Parse(time.RFC3339, "2026-11-01T08:30:00Z")
	due3 := crmSLADue(sun16Taipei, 5)
	if got := due3.Format(time.RFC3339); got != "2026-11-02T06:00:00Z" {
		t.Fatalf("Sunday 16:30 Taipei + 5hr SLA expected 2026-11-02T06:00:00Z, got %s", got)
	}

	// 4. After-hours creation (Wednesday 19:30 Taipei = 11:30 UTC) with 5-hour SLA
	// Starts Thursday 09:00 Taipei (01:00 UTC)
	// Expected: Thursday 14:00 Taipei (06:00 UTC)
	wedAfterHours, _ := time.Parse(time.RFC3339, "2026-10-28T11:30:00Z")
	due4 := crmSLADue(wedAfterHours, 5)
	if got := due4.Format(time.RFC3339); got != "2026-10-29T06:00:00Z" {
		t.Fatalf("Wednesday after-hours Taipei + 5hr SLA expected 2026-10-29T06:00:00Z, got %s", got)
	}

	// 5. Before-hours creation (Tuesday 06:15 Taipei = Monday 22:15 UTC) with 3-hour SLA
	// Starts Tuesday 09:00 Taipei (01:00 UTC)
	// Expected: Tuesday 12:00 Taipei (04:00 UTC)
	tueBeforeHours, _ := time.Parse(time.RFC3339, "2026-10-26T22:15:00Z")
	due5 := crmSLADue(tueBeforeHours, 3)
	if got := due5.Format(time.RFC3339); got != "2026-10-27T04:00:00Z" {
		t.Fatalf("Tuesday before-hours Taipei + 3hr SLA expected 2026-10-27T04:00:00Z, got %s", got)
	}

	// 6. Boundary test: Exactly at start of business day (Wednesday 09:00 Taipei = 01:00 UTC) with 9-hour SLA
	// 09:00 to 18:00 Taipei = exactly 9 working hours
	// Expected: Wednesday 18:00 Taipei (10:00 UTC)
	wedStart, _ := time.Parse(time.RFC3339, "2026-10-28T01:00:00Z")
	due6 := crmSLADue(wedStart, 9)
	if got := due6.Format(time.RFC3339); got != "2026-10-28T10:00:00Z" {
		t.Fatalf("Wednesday 09:00 Taipei + 9hr SLA expected 2026-10-28T10:00:00Z, got %s", got)
	}

	// 7. Boundary test: Exactly at end of business day (Wednesday 18:00 Taipei = 10:00 UTC) with 3-hour SLA
	// Advances to Thursday 09:00 Taipei
	// Expected: Thursday 12:00 Taipei (04:00 UTC)
	wedEnd, _ := time.Parse(time.RFC3339, "2026-10-28T10:00:00Z")
	due7 := crmSLADue(wedEnd, 3)
	if got := due7.Format(time.RFC3339); got != "2026-10-29T04:00:00Z" {
		t.Fatalf("Wednesday 18:00 Taipei + 3hr SLA expected 2026-10-29T04:00:00Z, got %s", got)
	}

	// 8. Multi-day spanning weekend: Thursday 16:00 Taipei (08:00 UTC) with 15-hour SLA
	// Thursday: 16:00-18:00 (2 hrs used, 13 hrs remain)
	// Friday: 09:00-18:00 (9 hrs used, 4 hrs remain)
	// Saturday & Sunday: skipped
	// Monday: 09:00 + 4 hrs = 13:00 Taipei (05:00 UTC)
	thuMultiDay, _ := time.Parse(time.RFC3339, "2026-10-29T08:00:00Z")
	due8 := crmSLADue(thuMultiDay, 15)
	if got := due8.Format(time.RFC3339); got != "2026-11-02T05:00:00Z" {
		t.Fatalf("Thursday 16:00 Taipei + 15hr SLA expected 2026-11-02T05:00:00Z, got %s", got)
	}
}

// TestCRMSLATaipeiRemainingWorkingSeconds verifies working duration countdown in Asia/Taipei.
func TestCRMSLATaipeiRemainingWorkingSeconds(t *testing.T) {
	dueMonday12Taipei, _ := time.Parse(time.RFC3339, "2026-11-02T04:00:00Z") // Monday 12:00 Taipei

	// 1. Friday 17:00 Taipei (09:00 UTC): 1 hour remaining on Friday + 3 hours on Monday = 4 hours (14400s)
	fri17Taipei, _ := time.Parse(time.RFC3339, "2026-10-30T09:00:00Z")
	rem1 := crmSLARemainingWorkingSeconds(fri17Taipei, dueMonday12Taipei, crmTaipeiLocation)
	if rem1 != 14400 {
		t.Fatalf("Friday 17:00 Taipei expected 14400s remaining, got %d", rem1)
	}

	// 2. Pause during weekend (Saturday 14:00 Taipei = 06:00 UTC):
	// Saturday consumes 0 business hours; remaining is Monday 09:00-12:00 = 3 hours (10800s)
	sat14Taipei, _ := time.Parse(time.RFC3339, "2026-10-31T06:00:00Z")
	rem2 := crmSLARemainingWorkingSeconds(sat14Taipei, dueMonday12Taipei, crmTaipeiLocation)
	if rem2 != 10800 {
		t.Fatalf("Saturday 14:00 Taipei expected 10800s remaining, got %d", rem2)
	}

	// 3. Pause during weekend (Sunday 20:00 Taipei = 12:00 UTC):
	// Sunday consumes 0 business hours; remaining is Monday 09:00-12:00 = 3 hours (10800s)
	sun20Taipei, _ := time.Parse(time.RFC3339, "2026-11-01T12:00:00Z")
	rem3 := crmSLARemainingWorkingSeconds(sun20Taipei, dueMonday12Taipei, crmTaipeiLocation)
	if rem3 != 10800 {
		t.Fatalf("Sunday 20:00 Taipei expected 10800s remaining, got %d", rem3)
	}

	// 4. Pause after-hours on weekday (Wednesday 20:00 Taipei = 12:00 UTC):
	// Target is Thursday 14:00 Taipei (06:00 UTC); remaining is Thursday 09:00-14:00 = 5 hours (18000s)
	dueThu14Taipei, _ := time.Parse(time.RFC3339, "2026-10-29T06:00:00Z")
	wed20Taipei, _ := time.Parse(time.RFC3339, "2026-10-28T12:00:00Z")
	rem4 := crmSLARemainingWorkingSeconds(wed20Taipei, dueThu14Taipei, crmTaipeiLocation)
	if rem4 != 18000 {
		t.Fatalf("Wednesday 20:00 Taipei expected 18000s remaining, got %d", rem4)
	}

	// 5. Pause before-hours on weekday (Thursday 07:00 Taipei = Wednesday 23:00 UTC):
	// Target is Thursday 14:00 Taipei (06:00 UTC); remaining is Thursday 09:00-14:00 = 5 hours (18000s)
	thu07Taipei, _ := time.Parse(time.RFC3339, "2026-10-28T23:00:00Z")
	rem5 := crmSLARemainingWorkingSeconds(thu07Taipei, dueThu14Taipei, crmTaipeiLocation)
	if rem5 != 18000 {
		t.Fatalf("Thursday 07:00 Taipei expected 18000s remaining, got %d", rem5)
	}

	// 6. Past due / expired: returns 0
	afterDue, _ := time.Parse(time.RFC3339, "2026-11-02T05:00:00Z")
	if remExpired := crmSLARemainingWorkingSeconds(afterDue, dueMonday12Taipei, crmTaipeiLocation); remExpired != 0 {
		t.Fatalf("past due expected 0, got %d", remExpired)
	}

	// 7. Timezone discrepancy cross-check:
	// Friday 17:00 UTC is Saturday 01:00 AM in Taipei (weekend!).
	// If evaluated in UTC, Friday 17:00 UTC has 1 working hour on Friday.
	// If evaluated in Taipei, it is already Saturday, so remaining to Monday 12:00 Taipei is exactly 3 hours (10800s).
	fri17UTC, _ := time.Parse(time.RFC3339, "2026-10-30T17:00:00Z")
	remCross := crmSLARemainingWorkingSeconds(fri17UTC, dueMonday12Taipei, crmTaipeiLocation)
	if remCross != 10800 {
		t.Fatalf("Friday 17:00 UTC (Saturday 01:00 Taipei) expected 10800s, got %d", remCross)
	}
}

// TestCRMSLATaipeiAddWorkingDuration verifies resume/reopen addition of remaining business seconds.
func TestCRMSLATaipeiAddWorkingDuration(t *testing.T) {
	// 1. Reopen during business hours (Tuesday 10:00 Taipei = 02:00 UTC) with 4 hours (14400s)
	// Tuesday 10:00 + 4h = Tuesday 14:00 Taipei (06:00 UTC)
	tue10Taipei, _ := time.Parse(time.RFC3339, "2026-11-03T02:00:00Z")
	newDue1 := crmSLAAddWorkingDuration(tue10Taipei, 14400, crmTaipeiLocation)
	if got := newDue1.Format(time.RFC3339); got != "2026-11-03T06:00:00Z" {
		t.Fatalf("Tuesday 10:00 Taipei + 4h expected 2026-11-03T06:00:00Z, got %s", got)
	}

	// 2. Reopen on Saturday (Saturday 11:00 Taipei = 03:00 UTC) with 4 hours (14400s)
	// Advances to Monday 09:00 Taipei + 4h = Monday 13:00 Taipei (05:00 UTC)
	sat11Taipei, _ := time.Parse(time.RFC3339, "2026-10-31T03:00:00Z")
	newDue2 := crmSLAAddWorkingDuration(sat11Taipei, 14400, crmTaipeiLocation)
	if got := newDue2.Format(time.RFC3339); got != "2026-11-02T05:00:00Z" {
		t.Fatalf("Saturday 11:00 Taipei + 4h expected 2026-11-02T05:00:00Z, got %s", got)
	}

	// 3. Reopen on Sunday (Sunday 15:00 Taipei = 07:00 UTC) with 5 hours (18000s)
	// Advances to Monday 09:00 Taipei + 5h = Monday 14:00 Taipei (06:00 UTC)
	sun15Taipei, _ := time.Parse(time.RFC3339, "2026-11-01T07:00:00Z")
	newDue3 := crmSLAAddWorkingDuration(sun15Taipei, 18000, crmTaipeiLocation)
	if got := newDue3.Format(time.RFC3339); got != "2026-11-02T06:00:00Z" {
		t.Fatalf("Sunday 15:00 Taipei + 5h expected 2026-11-02T06:00:00Z, got %s", got)
	}

	// 4. Reopen after-hours (Wednesday 20:00 Taipei = 12:00 UTC) with 3 hours (10800s)
	// Advances to Thursday 09:00 Taipei + 3h = Thursday 12:00 Taipei (04:00 UTC)
	wed20Taipei, _ := time.Parse(time.RFC3339, "2026-10-28T12:00:00Z")
	newDue4 := crmSLAAddWorkingDuration(wed20Taipei, 10800, crmTaipeiLocation)
	if got := newDue4.Format(time.RFC3339); got != "2026-10-29T04:00:00Z" {
		t.Fatalf("Wednesday 20:00 Taipei + 3h expected 2026-10-29T04:00:00Z, got %s", got)
	}

	// 5. Reopen before-hours (Thursday 06:00 Taipei = Wednesday 22:00 UTC) with 2 hours (7200s)
	// Advances to Thursday 09:00 Taipei + 2h = Thursday 11:00 Taipei (03:00 UTC)
	thu06Taipei, _ := time.Parse(time.RFC3339, "2026-10-28T22:00:00Z")
	newDue5 := crmSLAAddWorkingDuration(thu06Taipei, 7200, crmTaipeiLocation)
	if got := newDue5.Format(time.RFC3339); got != "2026-10-29T03:00:00Z" {
		t.Fatalf("Thursday 06:00 Taipei + 2h expected 2026-10-29T03:00:00Z, got %s", got)
	}

	// 6. Reopen Friday afternoon spanning weekend (Friday 16:00 Taipei = 08:00 UTC) with 4 hours (14400s)
	// Friday: 16:00-18:00 (2h used, 2h remain). Sat/Sun skipped.
	// Monday: 09:00 + 2h = Monday 11:00 Taipei (03:00 UTC)
	fri16Taipei, _ := time.Parse(time.RFC3339, "2026-10-30T08:00:00Z")
	newDue6 := crmSLAAddWorkingDuration(fri16Taipei, 14400, crmTaipeiLocation)
	if got := newDue6.Format(time.RFC3339); got != "2026-11-02T03:00:00Z" {
		t.Fatalf("Friday 16:00 Taipei + 4h expected 2026-11-02T03:00:00Z, got %s", got)
	}
}

// TestCRMTicketPauseReopenWeekendAndBoundariesAPI exercises the HTTP endpoints
// for weekend pause/reopen and business hour boundary handling in Taipei timezone.
func TestCRMTicketPauseReopenWeekendAndBoundariesAPI(t *testing.T) {
	a := appForTest(t)
	space := token()
	org := "org_test_" + space
	office := loginSite(t, a, "office@suite.test", space, "crm")
	path := "/api/stations/crm/support"

	var account string
	if err := a.db.QueryRow("SELECT id FROM crm_accounts WHERE organization_id=? LIMIT 1", org).Scan(&account); err != nil {
		t.Fatal(err)
	}

	// Test Case 1: Create ticket on Friday 15:00 Taipei (07:00 UTC), pause on Saturday (weekend), reopen on Sunday (weekend)
	createReq1 := map[string]any{
		"action":         "ticket",
		"accountId":      account,
		"subject":        "Weekend pause and reopen SLA test",
		"priority":       "high",
		"slaHours":       6,
		"idempotencyKey": "ticket-weekend-pause-01",
	}
	w1 := request(a, "POST", path, createReq1, office...)
	if w1.Code != 200 {
		t.Fatalf("create ticket failed: %d %s", w1.Code, w1.Body.String())
	}
	var tktRes1 struct {
		Data struct {
			TicketID string `json:"ticketId"`
			DueAt    string `json:"dueAt"`
		} `json:"data"`
	}
	json.Unmarshal(w1.Body.Bytes(), &tktRes1)
	ticketID1 := tktRes1.Data.TicketID

	// Seed created_at to Friday 15:00 Taipei (07:00 UTC) and due_at to Monday 12:00 Taipei (04:00 UTC)
	fri15 := "2026-10-30T07:00:00Z"
	mon12 := "2026-11-02T04:00:00Z"
	if _, err := a.db.Exec("UPDATE crm_tickets SET created_at=?, due_at=? WHERE id=?", fri15, mon12, ticketID1); err != nil {
		t.Fatal(err)
	}

	// Pause on Saturday 14:00 Taipei (06:00 UTC)
	// Friday 15:00 to 18:00 Taipei used 3 working hours.
	// Saturday is weekend (0 working hours used).
	// Remaining working duration = 3 hours = 10800 seconds.
	pauseReq1 := map[string]any{
		"action":         "pause-ticket",
		"ticketId":       ticketID1,
		"reason":         "Paused over Saturday weekend",
		"time":           "2026-10-31T06:00:00Z",
		"idempotencyKey": "pause-sat-weekend-01",
	}
	wPause1 := request(a, "POST", path, pauseReq1, office...)
	if wPause1.Code != 200 {
		t.Fatalf("pause on Saturday failed: %d %s", wPause1.Code, wPause1.Body.String())
	}
	var pauseResult1 struct {
		Data struct {
			Status              string `json:"status"`
			SlaRemainingSeconds int64  `json:"slaRemainingSeconds"`
		} `json:"data"`
	}
	json.Unmarshal(wPause1.Body.Bytes(), &pauseResult1)
	if pauseResult1.Data.Status != "pending_customer" {
		t.Fatalf("expected pending_customer, got %s", pauseResult1.Data.Status)
	}
	if pauseResult1.Data.SlaRemainingSeconds != 10800 {
		t.Fatalf("Saturday pause expected 10800 remaining seconds (3 working hours), got %d", pauseResult1.Data.SlaRemainingSeconds)
	}

	// Reopen on Sunday 16:00 Taipei (08:00 UTC)
	// Sunday is weekend; countdown resumes on Monday 09:00 Taipei.
	// 3 remaining hours -> Monday 12:00 Taipei (04:00 UTC)
	reopenReq1 := map[string]any{
		"action":         "reopen-ticket",
		"ticketId":       ticketID1,
		"time":           "2026-11-01T08:00:00Z",
		"idempotencyKey": "reopen-sun-weekend-01",
	}
	wReopen1 := request(a, "POST", path, reopenReq1, office...)
	if wReopen1.Code != 200 {
		t.Fatalf("reopen on Sunday failed: %d %s", wReopen1.Code, wReopen1.Body.String())
	}
	var reopenResult1 struct {
		Data struct {
			Status string `json:"status"`
			DueAt  string `json:"dueAt"`
		} `json:"data"`
	}
	json.Unmarshal(wReopen1.Body.Bytes(), &reopenResult1)
	if reopenResult1.Data.Status != "open" {
		t.Fatalf("expected open, got %s", reopenResult1.Data.Status)
	}
	if reopenResult1.Data.DueAt != "2026-11-02T04:00:00Z" {
		t.Fatalf("Sunday reopen expected dueAt 2026-11-02T04:00:00Z, got %s", reopenResult1.Data.DueAt)
	}

	// Test Case 2: Pause ticket with missing/null due_at (triggers fallback calculation via crmSLADue in Taipei)
	createReq2 := map[string]any{
		"action":         "ticket",
		"accountId":      account,
		"subject":        "Fallback dueAt calculation test",
		"priority":       "medium",
		"slaHours":       6,
		"idempotencyKey": "ticket-fallback-due-01",
	}
	w2 := request(a, "POST", path, createReq2, office...)
	if w2.Code != 200 {
		t.Fatalf("create ticket 2 failed: %d", w2.Code)
	}
	var tktRes2 struct {
		Data struct {
			TicketID string `json:"ticketId"`
		} `json:"data"`
	}
	json.Unmarshal(w2.Body.Bytes(), &tktRes2)
	ticketID2 := tktRes2.Data.TicketID

	// Set created_at to Friday 15:00 Taipei (07:00 UTC) and clear due_at to NULL
	if _, err := a.db.Exec("UPDATE crm_tickets SET created_at=?, due_at=NULL WHERE id=?", fri15, ticketID2); err != nil {
		t.Fatal(err)
	}

	// Pause at Friday 17:00 Taipei (09:00 UTC)
	// Fallback computes due_at via crmSLADue(created, 6) -> Monday 12:00 Taipei (04:00 UTC).
	// Friday 17:00 to 18:00 (1h) + Mon 09:00 to 12:00 (3h) = 4 hours (14400s).
	pauseReq2 := map[string]any{
		"action":         "pause-ticket",
		"ticketId":       ticketID2,
		"reason":         "Pause with fallback due_at",
		"time":           "2026-10-30T09:00:00Z",
		"idempotencyKey": "pause-fallback-due-01",
	}
	wPause2 := request(a, "POST", path, pauseReq2, office...)
	if wPause2.Code != 200 {
		t.Fatalf("pause with fallback due_at failed: %d %s", wPause2.Code, wPause2.Body.String())
	}
	var pauseResult2 struct {
		Data struct {
			SlaRemainingSeconds int64 `json:"slaRemainingSeconds"`
		} `json:"data"`
	}
	json.Unmarshal(wPause2.Body.Bytes(), &pauseResult2)
	if pauseResult2.Data.SlaRemainingSeconds != 14400 {
		t.Fatalf("fallback due_at pause expected 14400s, got %d", pauseResult2.Data.SlaRemainingSeconds)
	}

	// Test Case 3: Boundary pause at exactly 18:00 Taipei (10:00 UTC), reopen at exactly 09:00 Taipei (01:00 UTC)
	// Create ticket, set created_at = Friday 15:00 Taipei, due_at = Monday 12:00 Taipei
	if _, err := a.db.Exec("UPDATE crm_tickets SET status='open', created_at=?, due_at=?, paused_at=NULL, sla_remaining_seconds=NULL WHERE id=?", fri15, mon12, ticketID2); err != nil {
		t.Fatal(err)
	}
	// Pause at exactly Friday 18:00 Taipei (10:00 UTC):
	// Friday 15:00 to 18:00 used exactly 3 working hours; 3 hours remain (10800s).
	pauseReq3 := map[string]any{
		"action":         "pause-ticket",
		"ticketId":       ticketID2,
		"reason":         "Pause at 18:00 Taipei boundary",
		"time":           "2026-10-30T10:00:00Z",
		"idempotencyKey": "pause-boundary-1800-01",
	}
	wPause3 := request(a, "POST", path, pauseReq3, office...)
	if wPause3.Code != 200 {
		t.Fatalf("pause at 18:00 boundary failed: %d %s", wPause3.Code, wPause3.Body.String())
	}
	var pauseResult3 struct {
		Data struct {
			SlaRemainingSeconds int64 `json:"slaRemainingSeconds"`
		} `json:"data"`
	}
	json.Unmarshal(wPause3.Body.Bytes(), &pauseResult3)
	if pauseResult3.Data.SlaRemainingSeconds != 10800 {
		t.Fatalf("18:00 boundary pause expected 10800s, got %d", pauseResult3.Data.SlaRemainingSeconds)
	}

	// Reopen at Tuesday 09:00 Taipei (01:00 UTC):
	// Reopened at start of business day with 3 remaining hours -> Tuesday 12:00 Taipei (04:00 UTC).
	reopenReq3 := map[string]any{
		"action":         "reopen-ticket",
		"ticketId":       ticketID2,
		"time":           "2026-11-03T01:00:00Z",
		"idempotencyKey": "reopen-boundary-0900-01",
	}
	wReopen3 := request(a, "POST", path, reopenReq3, office...)
	if wReopen3.Code != 200 {
		t.Fatalf("reopen at 09:00 boundary failed: %d %s", wReopen3.Code, wReopen3.Body.String())
	}
	var reopenResult3 struct {
		Data struct {
			DueAt string `json:"dueAt"`
		} `json:"data"`
	}
	json.Unmarshal(wReopen3.Body.Bytes(), &reopenResult3)
	if reopenResult3.Data.DueAt != "2026-11-03T04:00:00Z" {
		t.Fatalf("09:00 boundary reopen expected dueAt 2026-11-03T04:00:00Z, got %s", reopenResult3.Data.DueAt)
	}
}
