package main

import (
	"encoding/json"
	"net/http"
	"sync"
	"testing"
)

func crmLeadRequest(a *App, method, path string, input any, cookies ...*http.Cookie) (*http.Response, map[string]any) {
	w := request(a, method, path, input, cookies...)
	var result map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &result)
	return w.Result(), result
}

func TestCRMLeadLifecycleAuthorizationPersistenceAndAtomicConversion(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := login(t, a, "admin@suite.test", space)
	operator := login(t, a, "office@suite.test", space)
	front := login(t, a, "front@suite.test", space)
	viewer := login(t, a, "viewer@suite.test", space)
	otherTenant := login(t, a, "admin@suite.test", token())
	path := "/api/stations/crm/leads"
	input := map[string]any{"name": "Ada Buyer", "company": "Analytical Engines", "email": "ada@example.test", "phone": "555-0142"}
	if r, _ := crmLeadRequest(a, http.MethodPost, path, input); r.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous create: %d", r.StatusCode)
	}
	for name, cookies := range map[string][]*http.Cookie{"front": front, "viewer": viewer} {
		if r, _ := crmLeadRequest(a, http.MethodPost, path, input, cookies...); r.StatusCode != http.StatusForbidden {
			t.Errorf("%s create allowed: %d", name, r.StatusCode)
		}
	}
	for _, cookies := range [][]*http.Cookie{admin, operator} {
		if r, _ := crmLeadRequest(a, http.MethodPost, path, map[string]any{"name": "Bad", "company": "ACME", "email": "bad@example.test", "organizationId": "other", "ownerId": "other"}, cookies...); r.StatusCode != http.StatusBadRequest {
			t.Fatalf("identity fields accepted: %d", r.StatusCode)
		}
	}
	r, created := crmLeadRequest(a, http.MethodPost, path, input, operator...)
	if r.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %#v", r.StatusCode, created)
	}
	data, _ := created["data"].(map[string]any)
	leadID, _ := data["id"].(string)
	if leadID == "" {
		t.Fatalf("missing lead id: %#v", created)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-qualify", map[string]any{"leadId": leadID}, otherTenant...); r.StatusCode != http.StatusConflict {
		t.Fatalf("cross-tenant qualification exposed lead: %d", r.StatusCode)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-qualify", map[string]any{"leadId": leadID}, operator...); r.StatusCode != http.StatusOK {
		t.Fatalf("qualify: %d", r.StatusCode)
	}
	var status string
	if e := a.db.QueryRow("SELECT status FROM crm_leads WHERE id=?", leadID).Scan(&status); e != nil || status != "qualified" {
		t.Fatalf("qualification not persisted: %q %v", status, e)
	}
	convertPath := "/api/stations/crm/lead-convert"
	convert := map[string]any{"leadId": leadID, "amount": 87500, "closeDate": "2027-03-31"}
	if response, _ := crmLeadRequest(a, http.MethodPost, convertPath, map[string]any{"leadId": leadID, "amount": int64(9007199254740992), "closeDate": "2027-03-31"}, operator...); response.StatusCode != http.StatusBadRequest {
		t.Fatalf("amount beyond browser integer precision accepted: %d", response.StatusCode)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, convertPath, convert, front...); r.StatusCode != http.StatusForbidden {
		t.Fatalf("front conversion allowed: %d", r.StatusCode)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, convertPath, map[string]any{"leadId": leadID, "amount": -1, "closeDate": "2027-03-31"}, operator...); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("negative amount accepted: %d", r.StatusCode)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, convertPath, map[string]any{"leadId": leadID, "amount": 1, "closeDate": "2027-02-30"}, operator...); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid close date accepted: %d", r.StatusCode)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, convertPath, map[string]any{"leadId": leadID, "closeDate": "2027-03-31"}, operator...); r.StatusCode != http.StatusBadRequest {
		t.Fatalf("omitted amount accepted: %d", r.StatusCode)
	}
	r, converted := crmLeadRequest(a, http.MethodPost, convertPath, convert, operator...)
	if r.StatusCode != http.StatusOK {
		t.Fatalf("convert: %d %#v", r.StatusCode, converted)
	}
	refs, _ := converted["data"].(map[string]any)
	var accountCount, contactCount, opportunityCount int
	for table, idKey := range map[string]string{"crm_accounts": "accountId", "crm_contacts": "contactId", "crm_opportunities": "opportunityId"} {
		id, _ := refs[idKey].(string)
		if id == "" {
			t.Fatalf("missing %s: %#v", idKey, refs)
		}
		if e := a.db.QueryRow("SELECT count(*) FROM "+table+" WHERE organization_id=(SELECT organization_id FROM crm_leads WHERE id=?) AND id=?", leadID, id).Scan(map[string]*int{"crm_accounts": &accountCount, "crm_contacts": &contactCount, "crm_opportunities": &opportunityCount}[table]); e != nil {
			t.Fatal(e)
		}
	}
	if accountCount != 1 || contactCount != 1 || opportunityCount != 1 {
		t.Fatalf("conversion rows %d/%d/%d", accountCount, contactCount, opportunityCount)
	}
	var amount int
	if e := a.db.QueryRow("SELECT amount FROM crm_opportunities WHERE id=?", refs["opportunityId"]).Scan(&amount); e != nil || amount != 87500 {
		t.Fatalf("amount not persisted: %d %v", amount, e)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, convertPath, convert, operator...); r.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate conversion should conflict: %d", r.StatusCode)
	}
	fixtureID := "crm_lead_01_org_test_" + space
	var fixtureOwner string
	if err := a.db.QueryRow("SELECT assigned_to FROM crm_leads WHERE organization_id=? AND id=?", "org_test_"+space, fixtureID).Scan(&fixtureOwner); err != nil || fixtureOwner != "org_test_"+space+"_admin" {
		t.Fatalf("demo fixture lead owner was not bound to demo administrator: %q %v", fixtureOwner, err)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-qualify", map[string]any{"leadId": fixtureID}, admin...); r.StatusCode != http.StatusOK {
		t.Fatalf("qualify fixture lead: %d", r.StatusCode)
	}
	if r, _ = crmLeadRequest(a, http.MethodPost, convertPath, map[string]any{"leadId": fixtureID, "amount": 0, "closeDate": "2027-03-31"}, operator...); r.StatusCode != http.StatusOK {
		t.Fatalf("convert fixture lead: %d", r.StatusCode)
	}
}

func TestCRMLeadConcurrentAndFailedConversionRollback(t *testing.T) {
	a := appForTest(t)
	space := token()
	cookies := login(t, a, "admin@suite.test", space)
	org := "org_test_" + space
	create := func(name string) string {
		res, body := crmLeadRequest(a, http.MethodPost, "/api/stations/crm/leads", map[string]any{"name": name, "company": "Atomic Co", "email": name + "@example.test"}, cookies...)
		if res.StatusCode != http.StatusCreated {
			t.Fatalf("create lead %d %#v", res.StatusCode, body)
		}
		id := body["data"].(map[string]any)["id"].(string)
		res, _ = crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-qualify", map[string]any{"leadId": id}, cookies...)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("qualify lead %d", res.StatusCode)
		}
		return id
	}
	first := create("Race")
	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			res, _ := crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-convert", map[string]any{"leadId": first, "amount": 10, "closeDate": "2027-01-01"}, cookies...)
			statuses <- res.StatusCode
		}()
	}
	wg.Wait()
	close(statuses)
	var successes, conflicts int
	for code := range statuses {
		if code == http.StatusOK {
			successes++
		}
		if code == http.StatusConflict {
			conflicts++
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent conversion statuses: %d success, %d conflict", successes, conflicts)
	}
	second := create("Rollback")
	if _, e := a.db.Exec("CREATE TRIGGER reject_crm_opportunity BEFORE INSERT ON crm_opportunities WHEN NEW.id='lead-opportunity:" + second + "' BEGIN SELECT RAISE(ABORT,'forced late failure'); END"); e != nil {
		t.Fatal(e)
	}
	res, _ := crmLeadRequest(a, http.MethodPost, "/api/stations/crm/lead-convert", map[string]any{"leadId": second, "amount": 10, "closeDate": "2027-01-01"}, cookies...)
	if res.StatusCode < 400 {
		t.Fatalf("forced opportunity failure reported success: %d", res.StatusCode)
	}
	var status string
	if e := a.db.QueryRow("SELECT status FROM crm_leads WHERE organization_id=? AND id=?", org, second).Scan(&status); e != nil || status != "qualified" {
		t.Fatalf("failed conversion changed lead: %s %v", status, e)
	}
	for _, table := range []string{"crm_accounts", "crm_contacts", "crm_opportunities"} {
		var n int
		if e := a.db.QueryRow("SELECT count(*) FROM "+table+" WHERE organization_id=? AND id LIKE '%"+second+"%'", org).Scan(&n); e != nil || n != 0 {
			t.Fatalf("failed conversion left %s rows=%d err=%v", table, n, e)
		}
	}
}
