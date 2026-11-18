package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
)

type crmOwnershipIdentity struct {
	UserID         string `json:"userId"`
	OrganizationID string `json:"organizationId"`
}

func crmOwnershipLogin(t *testing.T, a *App, email, space string) ([]*http.Cookie, crmOwnershipIdentity) {
	t.Helper()
	cookies := loginSite(t, a, email, space, "crm")
	w := request(a, http.MethodGet, "/api/auth/me", nil, cookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("read %s identity: %d %s", email, w.Code, w.Body.String())
	}
	var envelope struct {
		Data crmOwnershipIdentity `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	return cookies, envelope.Data
}

func crmDataIDs(t *testing.T, a *App, cookies []*http.Cookie, view string) map[string]map[string]bool {
	t.Helper()
	w := request(a, http.MethodGet, "/api/stations/crm/data?view="+view, nil, cookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("read CRM %s data: %d %s", view, w.Code, w.Body.String())
	}
	var envelope struct {
		Data map[string][]map[string]any `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	ids := make(map[string]map[string]bool, len(envelope.Data))
	for dataset, rows := range envelope.Data {
		ids[dataset] = map[string]bool{}
		for _, row := range rows {
			if id, ok := row["id"].(string); ok {
				ids[dataset][id] = true
			}
		}
	}
	return ids
}

func crmAppAtPath(t *testing.T, path string) *App {
	t.Helper()
	db, err := openDB(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return &App{db: db}
}

func TestCRMOpportunityOwnershipScopesRelatedReadData(t *testing.T) {
	a := appForTest(t)
	space, otherSpace := token(), token()
	adminCookies, admin := crmOwnershipLogin(t, a, "admin@suite.test", space)
	operatorCookies, operator := crmOwnershipLogin(t, a, "office@suite.test", space)
	viewerCookies, _ := crmOwnershipLogin(t, a, "viewer@suite.test", space)
	frontCookies, _ := crmOwnershipLogin(t, a, "front@suite.test", space)
	otherCookies, otherTenant := crmOwnershipLogin(t, a, "admin@suite.test", otherSpace)

	var opportunityID, stageID, accountID string
	var contactID sql.NullString
	if err := a.db.QueryRow(`SELECT id,stage_id,account_id,primary_contact_id FROM crm_opportunities
		WHERE organization_id=? ORDER BY id LIMIT 1`, operator.OrganizationID).Scan(&opportunityID, &stageID, &accountID, &contactID); err != nil {
		t.Fatal(err)
	}
	peerOpportunityID := "ownership_peer_" + token()
	if _, err := a.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", operator.UserID, operator.OrganizationID, opportunityID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec(`INSERT INTO crm_opportunities(id,organization_id,name,account_id,primary_contact_id,owner_id,stage_id,amount,weighted_amount,probability,close_date,status)
		SELECT ?,organization_id,'Peer opportunity',account_id,primary_contact_id,?,stage_id,amount,weighted_amount,probability,close_date,status
		FROM crm_opportunities WHERE organization_id=? AND id=?`, peerOpportunityID, admin.UserID, operator.OrganizationID, opportunityID); err != nil {
		t.Fatal(err)
	}
	ownedQuoteID, peerQuoteID := "owned_quote_"+token(), "peer_quote_"+token()
	for _, fixture := range []struct{ id, opportunity string }{{ownedQuoteID, opportunityID}, {peerQuoteID, peerOpportunityID}} {
		if _, err := a.db.Exec(`INSERT INTO crm_quotes(id,organization_id,quote_number,opportunity_id,version,total_amount,status,is_locked)
			VALUES(?,?,?,?,1,250,'submitted',0)`, fixture.id, operator.OrganizationID, "QT-"+token(), fixture.opportunity); err != nil {
			t.Fatal(err)
		}
		if _, err := a.db.Exec(`INSERT INTO crm_quote_items(id,organization_id,quote_id,item_name,quantity,unit_price,line_total)
			VALUES(?,?,?,'Scoped item',1,250,250)`, "item_"+fixture.id, operator.OrganizationID, fixture.id); err != nil {
			t.Fatal(err)
		}
	}
	ownedActivityID, peerActivityID := "owned_activity_"+token(), "peer_activity_"+token()
	for _, fixture := range []struct{ id, owner, opportunity string }{{ownedActivityID, operator.UserID, opportunityID}, {peerActivityID, operator.UserID, peerOpportunityID}} {
		if _, err := a.db.Exec(`INSERT INTO crm_activities(id,organization_id,activity_type,subject,due_date,completed,owner_id,account_id,contact_id,opportunity_id)
			VALUES(?,?,'call','Scoped activity','2035-01-15 10:00',0,?,?,?,?)`, fixture.id, operator.OrganizationID, fixture.owner, accountID, contactID, fixture.opportunity); err != nil {
			t.Fatal(err)
		}
	}
	var foreignOpportunityID string
	if err := a.db.QueryRow("SELECT id FROM crm_opportunities WHERE organization_id=? ORDER BY id LIMIT 1", otherTenant.OrganizationID).Scan(&foreignOpportunityID); err != nil {
		t.Fatal(err)
	}
	foreignQuoteID, foreignActivityID := "foreign_quote_"+token(), "foreign_activity_"+token()
	if _, err := a.db.Exec(`INSERT INTO crm_quotes(id,organization_id,quote_number,opportunity_id,version,total_amount,status,is_locked)
		VALUES(?,?,?, ?,1,250,'submitted',0)`, foreignQuoteID, otherTenant.OrganizationID, "QT-"+token(), foreignOpportunityID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec(`INSERT INTO crm_quote_items(id,organization_id,quote_id,item_name,quantity,unit_price,line_total)
		VALUES(?,?,?,'Foreign item',1,250,250)`, "item_"+foreignQuoteID, otherTenant.OrganizationID, foreignQuoteID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec(`INSERT INTO crm_activities(id,organization_id,activity_type,subject,due_date,completed,owner_id,opportunity_id)
		VALUES(?,?,'call','Foreign activity','2035-01-15 10:00',0,?,?)`, foreignActivityID, otherTenant.OrganizationID, otherTenant.UserID, foreignOpportunityID); err != nil {
		t.Fatal(err)
	}

	operatorData := crmDataIDs(t, a, operatorCookies, "back")
	for dataset, id := range map[string]string{"opportunities": opportunityID, "quotes": ownedQuoteID, "quoteItems": "item_" + ownedQuoteID, "activities": ownedActivityID} {
		if !operatorData[dataset][id] {
			t.Errorf("operator should see own %s %q", dataset, id)
		}
	}
	for _, fixture := range []struct{ dataset, id string }{
		{"opportunities", peerOpportunityID}, {"quotes", peerQuoteID}, {"quoteItems", "item_" + peerQuoteID}, {"activities", peerActivityID},
		{"opportunities", foreignOpportunityID}, {"quotes", foreignQuoteID}, {"quoteItems", "item_" + foreignQuoteID}, {"activities", foreignActivityID},
	} {
		if operatorData[fixture.dataset][fixture.id] {
			t.Errorf("operator must not see restricted %s %q", fixture.dataset, fixture.id)
		}
	}
	quotePrint := func(cookies []*http.Cookie, quoteID string) *httptest.ResponseRecorder {
		return request(a, http.MethodGet, "/api/stations/crm/print?kind=crm-quote&id="+quoteID, nil, cookies...)
	}
	if w := quotePrint(operatorCookies, ownedQuoteID); w.Code != http.StatusOK {
		t.Errorf("operator should print own quote: %d %s", w.Code, w.Body.String())
	}
	if w := quotePrint(operatorCookies, peerQuoteID); w.Code != http.StatusNotFound {
		t.Errorf("operator print exposed colleague quote: %d", w.Code)
	}
	if w := quotePrint(operatorCookies, foreignQuoteID); w.Code != http.StatusNotFound {
		t.Errorf("operator print exposed foreign quote: %d", w.Code)
	}
	adminData := crmDataIDs(t, a, adminCookies, "back")
	for dataset, id := range map[string]string{"opportunities": peerOpportunityID, "quotes": peerQuoteID, "quoteItems": "item_" + peerQuoteID, "activities": peerActivityID} {
		if !adminData[dataset][id] {
			t.Errorf("admin should see team %s %q", dataset, id)
		}
	}
	if w := quotePrint(adminCookies, peerQuoteID); w.Code != http.StatusOK {
		t.Errorf("admin should print team quote: %d %s", w.Code, w.Body.String())
	}
	var quotesBeforeDeniedWrite int
	if err := a.db.QueryRow("SELECT count(*) FROM crm_quotes WHERE organization_id=? AND opportunity_id=?", operator.OrganizationID, peerOpportunityID).Scan(&quotesBeforeDeniedWrite); err != nil {
		t.Fatal(err)
	}
	quoteCreate := func(cookies []*http.Cookie, opportunityID, key string) *httptest.ResponseRecorder {
		return request(a, http.MethodPost, "/api/stations/crm/quotes", map[string]any{
			"action": "create", "opportunityId": opportunityID, "itemName": "Restricted deal",
			"quantity": 1, "unitPrice": 300, "idempotencyKey": key,
		}, cookies...)
	}
	if w := quoteCreate(operatorCookies, peerOpportunityID, "operator-peer-quote-create-001"); w.Code != http.StatusForbidden {
		t.Errorf("operator created quote for colleague's opportunity: %d %s", w.Code, w.Body.String())
	}
	var quotesAfterDeniedWrite int
	if err := a.db.QueryRow("SELECT count(*) FROM crm_quotes WHERE organization_id=? AND opportunity_id=?", operator.OrganizationID, peerOpportunityID).Scan(&quotesAfterDeniedWrite); err != nil || quotesAfterDeniedWrite != quotesBeforeDeniedWrite {
		t.Errorf("denied quote write persisted a row: count=%d err=%v", quotesAfterDeniedWrite, err)
	}
	if w := quoteCreate(adminCookies, peerOpportunityID, "admin-peer-quote-create-001"); w.Code != http.StatusOK {
		t.Errorf("admin could not create team quote: %d %s", w.Code, w.Body.String())
	}
	const ownQuoteRetryKey = "operator-own-quote-create-001"
	if w := quoteCreate(operatorCookies, opportunityID, ownQuoteRetryKey); w.Code != http.StatusOK {
		t.Fatalf("operator could not create own quote: %d %s", w.Code, w.Body.String())
	}
	var ownedQuoteCount int
	if err := a.db.QueryRow("SELECT count(*) FROM crm_quotes WHERE organization_id=? AND opportunity_id=?", operator.OrganizationID, opportunityID).Scan(&ownedQuoteCount); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", admin.UserID, operator.OrganizationID, opportunityID); err != nil {
		t.Fatal(err)
	}
	if w := quoteCreate(operatorCookies, opportunityID, ownQuoteRetryKey); w.Code != http.StatusForbidden {
		t.Errorf("reassigned opportunity quote retry should be denied: %d %s", w.Code, w.Body.String())
	}
	var ownedQuoteCountAfterRetry int
	if err := a.db.QueryRow("SELECT count(*) FROM crm_quotes WHERE organization_id=? AND opportunity_id=?", operator.OrganizationID, opportunityID).Scan(&ownedQuoteCountAfterRetry); err != nil || ownedQuoteCountAfterRetry != ownedQuoteCount {
		t.Errorf("reassigned quote retry changed records: count=%d err=%v", ownedQuoteCountAfterRetry, err)
	}
	viewerData := crmDataIDs(t, a, viewerCookies, "back")
	if viewerData["opportunities"][opportunityID] || viewerData["opportunities"][peerOpportunityID] {
		t.Fatal("read-only role must not receive other users' opportunities")
	}
	frontBack := request(a, http.MethodGet, "/api/stations/crm/data?view=back", nil, frontCookies...)
	if frontBack.Code != http.StatusForbidden {
		t.Fatalf("front-office back data status %d", frontBack.Code)
	}
	frontData := crmDataIDs(t, a, frontCookies, "front")
	if frontData["opportunities"][opportunityID] || frontData["quotes"][ownedQuoteID] || frontData["quoteItems"]["item_"+ownedQuoteID] || frontData["activities"][ownedActivityID] {
		t.Fatal("front-office projection exposed CRM back-office records")
	}
	if operator.OrganizationID == otherTenant.OrganizationID {
		t.Fatal("test organizations were not isolated")
	}
	other := crmDataIDs(t, a, otherCookies, "back")
	for dataset, id := range map[string]string{"opportunities": foreignOpportunityID, "quotes": foreignQuoteID, "quoteItems": "item_" + foreignQuoteID, "activities": foreignActivityID} {
		if !other[dataset][id] {
			t.Errorf("foreign tenant should see its own %s %q", dataset, id)
		}
	}
	if other["opportunities"][opportunityID] || other["opportunities"][peerOpportunityID] {
		t.Fatal("another tenant saw scoped opportunities")
	}
}

func TestCRMOpportunityOwnershipGuardsStageWrites(t *testing.T) {
	a := appForTest(t)
	space, otherSpace := token(), token()
	adminCookies, admin := crmOwnershipLogin(t, a, "admin@suite.test", space)
	operatorCookies, operator := crmOwnershipLogin(t, a, "office@suite.test", space)
	viewerCookies, _ := crmOwnershipLogin(t, a, "viewer@suite.test", space)
	otherCookies, otherTenant := crmOwnershipLogin(t, a, "admin@suite.test", otherSpace)

	var ownedOpportunity, initialStage, targetStage string
	if err := a.db.QueryRow(`SELECT o.id,o.stage_id FROM crm_opportunities o WHERE o.organization_id=? ORDER BY o.id LIMIT 1`, operator.OrganizationID).Scan(&ownedOpportunity, &initialStage); err != nil {
		t.Fatal(err)
	}
	if _, err := a.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", operator.UserID, operator.OrganizationID, ownedOpportunity); err != nil {
		t.Fatal(err)
	}
	peerOpportunity := "stage_peer_" + token()
	if _, err := a.db.Exec(`INSERT INTO crm_opportunities(id,organization_id,name,owner_id,stage_id,amount,weighted_amount,probability,status)
		SELECT ?,organization_id,'Peer stage fixture',?,stage_id,amount,weighted_amount,probability,status FROM crm_opportunities WHERE organization_id=? AND id=?`, peerOpportunity, admin.UserID, operator.OrganizationID, ownedOpportunity); err != nil {
		t.Fatal(err)
	}
	if err := a.db.QueryRow("SELECT id FROM crm_stages WHERE organization_id=? AND id<>? ORDER BY position LIMIT 1", operator.OrganizationID, initialStage).Scan(&targetStage); err != nil {
		t.Fatal(err)
	}
	var beforeAudits int
	if err := a.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='crm.opportunity.stage'", operator.OrganizationID).Scan(&beforeAudits); err != nil {
		t.Fatal(err)
	}
	const peerRequestID = "operator-peer-ownership-001"

	stageRequest := func(cookies []*http.Cookie, opportunity, expected, requestID string) *httptest.ResponseRecorder {
		t.Helper()
		return request(a, http.MethodPost, "/api/stations/crm/opportunity-stage", map[string]any{
			"opportunityId": opportunity, "expectedStageId": expected, "stageId": targetStage,
			"reason": "Ownership test", "requestId": requestID,
		}, cookies...)
	}
	peerStage, err := func() (string, error) {
		var value string
		err := a.db.QueryRow("SELECT stage_id FROM crm_opportunities WHERE organization_id=? AND id=?", operator.OrganizationID, peerOpportunity).Scan(&value)
		return value, err
	}()
	if err != nil {
		t.Fatal(err)
	}
	if w := stageRequest(operatorCookies, peerOpportunity, peerStage, peerRequestID); w.Code != http.StatusForbidden {
		t.Fatalf("operator could stage colleague opportunity: %d %s", w.Code, w.Body.String())
	}
	var unchanged string
	if err := a.db.QueryRow("SELECT stage_id FROM crm_opportunities WHERE organization_id=? AND id=?", operator.OrganizationID, peerOpportunity).Scan(&unchanged); err != nil || unchanged != peerStage {
		t.Fatalf("denied peer update changed stage to %q: %v", unchanged, err)
	}
	var auditsAfterDenied int
	if err := a.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='crm.opportunity.stage'", operator.OrganizationID).Scan(&auditsAfterDenied); err != nil || auditsAfterDenied != beforeAudits {
		t.Fatalf("denied peer update wrote an audit event: %d, %v", auditsAfterDenied, err)
	}
	var deniedRetryRows int
	if err := a.db.QueryRow("SELECT count(*) FROM idempotency_keys WHERE organization_id=? AND endpoint='/station/crm/opportunity-stage' AND key=?", operator.OrganizationID, peerRequestID).Scan(&deniedRetryRows); err != nil || deniedRetryRows != 0 {
		t.Fatalf("denied peer update wrote retry state: %d, %v", deniedRetryRows, err)
	}
	if w := stageRequest(operatorCookies, ownedOpportunity, initialStage, "operator-own-ownership-001"); w.Code != http.StatusOK {
		t.Fatalf("operator own opportunity stage: %d %s", w.Code, w.Body.String())
	}
	if _, err := a.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", admin.UserID, operator.OrganizationID, ownedOpportunity); err != nil {
		t.Fatal(err)
	}
	if w := stageRequest(operatorCookies, ownedOpportunity, initialStage, "operator-own-ownership-001"); w.Code != http.StatusForbidden {
		t.Fatalf("reassigned opportunity retry should be denied: %d %s", w.Code, w.Body.String())
	}
	if w := stageRequest(viewerCookies, ownedOpportunity, targetStage, "viewer-own-ownership-001"); w.Code != http.StatusForbidden {
		t.Fatalf("read-only stage update status %d", w.Code)
	}
	if w := stageRequest(adminCookies, peerOpportunity, peerStage, "admin-team-ownership-001"); w.Code != http.StatusOK {
		t.Fatalf("admin team update: %d %s", w.Code, w.Body.String())
	}
	var foreignOpportunity, foreignStage string
	if err := a.db.QueryRow("SELECT id,stage_id FROM crm_opportunities WHERE organization_id=? ORDER BY id LIMIT 1", otherTenant.OrganizationID).Scan(&foreignOpportunity, &foreignStage); err != nil {
		t.Fatal(err)
	}
	if w := stageRequest(operatorCookies, foreignOpportunity, foreignStage, "operator-foreign-own-001"); w.Code != http.StatusNotFound {
		t.Fatalf("cross-tenant opportunity status %d", w.Code)
	}
	if operator.OrganizationID == otherTenant.OrganizationID || otherCookies == nil {
		t.Fatal("cross-tenant fixture was not initialized")
	}
}

func TestCRMOpportunitySameKeyAcrossIndependentDBHandles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "crm-shared.sqlite")
	first := crmAppAtPath(t, path)
	space := token()
	adminCookies := loginSite(t, first, "admin@suite.test", space, "crm")
	operatorCookies, operator := crmOwnershipLogin(t, first, "office@suite.test", space)
	org, opportunity, initial, _, _ := stageFixture(t, first, adminCookies)
	if _, err := first.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", operator.UserID, org, opportunity); err != nil {
		t.Fatal(err)
	}
	second := crmAppAtPath(t, path)

	var target string
	if err := first.db.QueryRow("SELECT id FROM crm_stages WHERE organization_id=? AND is_won=0 AND is_lost=0 AND id<>? ORDER BY position,id LIMIT 1", org, initial).Scan(&target); err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{
		"opportunityId": opportunity, "expectedStageId": initial, "stageId": target,
		"reason": "Same-key independent-handle probe", "requestId": "same-key-independent-db-0001",
	}
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	var wait sync.WaitGroup
	for _, app := range []*App{first, second} {
		wait.Add(1)
		go func(app *App) {
			defer wait.Done()
			<-start
			results <- request(app, http.MethodPost, "/api/stations/crm/opportunity-stage", payload, operatorCookies...)
		}(app)
	}
	close(start)
	wait.Wait()
	close(results)

	var successBody []byte
	transientFailures := 0
	for result := range results {
		switch result.Code {
		case http.StatusOK:
			if successBody != nil && !bytes.Equal(successBody, result.Body.Bytes()) {
				t.Fatalf("same-key requests returned different results: %s / %s", successBody, result.Body.String())
			}
			successBody = append([]byte(nil), result.Body.Bytes()...)
		case http.StatusServiceUnavailable:
			// SQLite may reject a concurrent WAL snapshot upgrade. The API tells
			// clients to retry; the idempotency key must make that retry safe.
			transientFailures++
		default:
			t.Fatalf("same-key request returned %d: %s", result.Code, result.Body.String())
		}
	}
	if successBody == nil {
		t.Fatal("neither same-key request committed")
	}
	if transientFailures > 0 {
		retry := request(second, http.MethodPost, "/api/stations/crm/opportunity-stage", payload, operatorCookies...)
		if retry.Code != http.StatusOK || !bytes.Equal(successBody, retry.Body.Bytes()) {
			t.Fatalf("same-key retry failed to replay the committed result: %d %s", retry.Code, retry.Body.String())
		}
	}
	var stage string
	if err := first.db.QueryRow("SELECT stage_id FROM crm_opportunities WHERE organization_id=? AND id=?", org, opportunity).Scan(&stage); err != nil || stage != target {
		t.Fatalf("same-key requests left stage=%q want=%q err=%v", stage, target, err)
	}
	var retryRows, stageAudits int
	if err := first.db.QueryRow("SELECT count(*) FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint='/station/crm/opportunity-stage'", org, payload["requestId"]).Scan(&retryRows); err != nil {
		t.Fatal(err)
	}
	if err := first.db.QueryRow("SELECT count(*) FROM audit_events WHERE organization_id=? AND action='crm.opportunity.stage' AND entity_id=?", org, opportunity).Scan(&stageAudits); err != nil {
		t.Fatal(err)
	}
	if retryRows != 1 || stageAudits != 1 {
		t.Fatalf("same-key replay duplicated effects: retry rows=%d stage audits=%d", retryRows, stageAudits)
	}
}

func TestCRMOwnershipReassignmentInvalidatesCachedResultsAcrossDBHandles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "crm-shared.sqlite")
	ownerApp := crmAppAtPath(t, path)
	space := token()
	adminCookies, admin := crmOwnershipLogin(t, ownerApp, "admin@suite.test", space)
	operatorCookies, operator := crmOwnershipLogin(t, ownerApp, "office@suite.test", space)
	org, opportunity, initial, _, _ := stageFixture(t, ownerApp, adminCookies)
	if _, err := ownerApp.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", operator.UserID, org, opportunity); err != nil {
		t.Fatal(err)
	}
	adminHandle := crmAppAtPath(t, path)
	stagePayload := map[string]any{
		"opportunityId": opportunity, "expectedStageId": initial, "stageId": "stage_reassignment_probe",
		"reason": "Ownership probe", "requestId": "stage-owner-reassign-001",
	}
	if _, err := adminHandle.db.Exec("INSERT INTO crm_stages(id,organization_id,name,position,probability,is_won,is_lost) VALUES(?,?, 'Reassignment probe', 99, 42, 0, 0)", stagePayload["stageId"], org); err != nil {
		t.Fatal(err)
	}
	stageResult := request(ownerApp, http.MethodPost, "/api/stations/crm/opportunity-stage", stagePayload, operatorCookies...)
	if stageResult.Code != http.StatusOK {
		t.Fatalf("owner stage update: %d %s", stageResult.Code, stageResult.Body.String())
	}
	if _, err := adminHandle.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", admin.UserID, org, opportunity); err != nil {
		t.Fatal(err)
	}
	if retry := request(ownerApp, http.MethodPost, "/api/stations/crm/opportunity-stage", stagePayload, operatorCookies...); retry.Code != http.StatusForbidden {
		t.Fatalf("former owner received cached stage result: %d %s", retry.Code, retry.Body.String())
	}

	if _, err := adminHandle.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", operator.UserID, org, opportunity); err != nil {
		t.Fatal(err)
	}
	quotePayload := map[string]any{
		"action": "create", "opportunityId": opportunity, "itemName": "Reassignment probe",
		"quantity": 1, "unitPrice": 400, "idempotencyKey": "quote-owner-reassign-001",
	}
	quoteResult := request(ownerApp, http.MethodPost, "/api/stations/crm/quotes", quotePayload, operatorCookies...)
	if quoteResult.Code != http.StatusOK {
		t.Fatalf("owner quote create: %d %s", quoteResult.Code, quoteResult.Body.String())
	}
	if _, err := adminHandle.db.Exec("UPDATE crm_opportunities SET owner_id=? WHERE organization_id=? AND id=?", admin.UserID, org, opportunity); err != nil {
		t.Fatal(err)
	}
	if retry := request(ownerApp, http.MethodPost, "/api/stations/crm/quotes", quotePayload, operatorCookies...); retry.Code != http.StatusForbidden {
		t.Fatalf("former owner received cached quote result: %d %s", retry.Code, retry.Body.String())
	}
}
