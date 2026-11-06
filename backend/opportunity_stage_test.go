package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"testing"
)

func stagePost(t *testing.T, a *App, cookies []*http.Cookie, payload map[string]any, status int) map[string]any {
	t.Helper()
	if payload["requestId"] == nil {
		payload["requestId"] = token()
	}
	w := request(a, "POST", "/api/stations/crm/opportunity-stage", payload, cookies...)
	if w.Code != status {
		t.Fatalf("stage expected%d got%d %s", status, w.Code, w.Body)
	}
	var result struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Data
}

func stageFixture(t *testing.T, a *App, cookies []*http.Cookie) (org, opportunity, initial, open, won string) {
	t.Helper()
	response, created := crmLeadRequest(a, "POST", "/api/stations/crm/leads", map[string]any{"name": "Pipeline fixture", "company": "Fictional pipeline", "email": token() + "@example.test"}, cookies...)
	if response.StatusCode != 201 {
		t.Fatal(created)
	}
	lead := created["data"].(map[string]any)["id"].(string)
	if r, body := crmLeadRequest(a, "POST", "/api/stations/crm/lead-qualify", map[string]any{"leadId": lead}, cookies...); r.StatusCode != 200 {
		t.Fatal(body)
	}
	r, converted := crmLeadRequest(a, "POST", "/api/stations/crm/lead-convert", map[string]any{"leadId": lead, "amount": 105, "closeDate": "2035-01-15"}, cookies...)
	if r.StatusCode != 200 {
		t.Fatal(converted)
	}
	opportunity = converted["data"].(map[string]any)["opportunityId"].(string)
	if err := a.db.QueryRow("SELECT organization_id,stage_id FROM crm_opportunities WHERE id=?", opportunity).Scan(&org, &initial); err != nil {
		t.Fatal(err)
	}
	open, won = "stage_"+token(), "stage_"+token()
	if _, err := a.db.Exec("INSERT INTO crm_stages(id,organization_id,name,position,probability,is_won,is_lost) VALUES(?,?,'Negotiation fixture',20,37,0,0),(?,?,'Won fixture',30,100,1,0)", open, org, won, org); err != nil {
		t.Fatal(err)
	}
	return
}

func TestOpportunityStagePersistenceRoundingReplayAndClosing(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := login(t, a, "admin@suite.test", space)
	_, opportunity, initial, open, won := stageFixture(t, a, admin)
	input := map[string]any{"opportunityId": opportunity, "expectedStageId": initial, "stageId": open, "reason": "", "requestId": token()}
	stagePost(t, a, admin, input, 200)
	stagePost(t, a, admin, input, 200)
	var stage, status string
	var amount, weighted, probability int64
	if err := a.db.QueryRow("SELECT stage_id,status,amount,weighted_amount,probability FROM crm_opportunities WHERE id=?", opportunity).Scan(&stage, &status, &amount, &weighted, &probability); err != nil {
		t.Fatal(err)
	}
	if stage != open || status != "open" || amount != 105 || weighted != 39 || probability != 37 {
		t.Fatalf("stage=%s status=%s amount=%d weighted=%d probability=%d", stage, status, amount, weighted, probability)
	}
	input["reason"] = "changed payload"
	stagePost(t, a, admin, input, 409)
	input["reason"] = ""
	stagePost(t, a, login(t, a, "office@suite.test", space), input, 409)
	stagePost(t, a, admin, map[string]any{"opportunityId": opportunity, "expectedStageId": initial, "stageId": won, "reason": "Won deal"}, 409)
	stagePost(t, a, admin, map[string]any{"opportunityId": opportunity, "expectedStageId": open, "stageId": won, "reason": " "}, 400)
	stagePost(t, a, admin, map[string]any{"opportunityId": opportunity, "expectedStageId": open, "stageId": won, "reason": "Signed agreement"}, 200)
	var reason string
	if err := a.db.QueryRow("SELECT status,won_reason,weighted_amount FROM crm_opportunities WHERE id=?", opportunity).Scan(&status, &reason, &weighted); err != nil {
		t.Fatal(err)
	}
	if status != "won" || reason != "Signed agreement" || weighted != 105 {
		t.Fatalf("closing %s %s %d", status, reason, weighted)
	}
}

func TestOpportunityStageAuthorizationAndAuditRollback(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := login(t, a, "admin@suite.test", space)
	org, opportunity, initial, open, _ := stageFixture(t, a, admin)
	payload := map[string]any{"opportunityId": opportunity, "expectedStageId": initial, "stageId": open, "requestId": token()}
	stagePost(t, a, nil, payload, 401)
	for _, email := range []string{"front@suite.test", "viewer@suite.test"} {
		stagePost(t, a, login(t, a, email, space), payload, 403)
	}
	stagePost(t, a, login(t, a, "admin@suite.test", token()), payload, 404)
	var beforeAudit int
	if err := a.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=?", org).Scan(&beforeAudit); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("CREATE TRIGGER pipeline_late_failure BEFORE INSERT ON audit_events BEGIN SELECT RAISE(ABORT,'pipeline failure'); END"); err != nil {
		t.Fatal(err)
	}
	stagePost(t, a, admin, payload, 503)
	var stage string
	var audits, retries int
	if err := a.db.QueryRow("SELECT stage_id FROM crm_opportunities WHERE id=?", opportunity).Scan(&stage); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=?", org).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT count(*) FROM idempotency_keys WHERE organization_id=? AND key=?", org, payload["requestId"]).Scan(&retries); err != nil {
		t.Fatal(err)
	}
	if stage != initial || audits != beforeAudit || retries != 0 {
		t.Fatalf("rollback stage=%s audit=%d/%d retries=%d", stage, audits, beforeAudit, retries)
	}
}

func TestOpportunityStageConcurrentExpectedStateAllowsOneWinner(t *testing.T) {
	a := appForTest(t)
	admin := login(t, a, "admin@suite.test", token())
	_, opportunity, initial, open, won := stageFixture(t, a, admin)
	var wg sync.WaitGroup
	results := make(chan int, 2)
	for _, target := range []string{open, won} {
		wg.Add(1)
		go func(stage string) {
			defer wg.Done()
			results <- request(a, "POST", "/api/stations/crm/opportunity-stage", map[string]any{"opportunityId": opportunity, "expectedStageId": initial, "stageId": stage, "reason": "Confirmed outcome", "requestId": token()}, admin...).Code
		}(target)
	}
	wg.Wait()
	close(results)
	success, conflicts := 0, 0
	for code := range results {
		if code == 200 {
			success++
		} else if code == 409 {
			conflicts++
		} else {
			t.Fatalf("unexpected stage race status%d", code)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatalf("success=%d conflicts=%d", success, conflicts)
	}
}
