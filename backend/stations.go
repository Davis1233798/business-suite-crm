package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type Dataset struct {
	Key, Table, Label string
	Front             []string
}

var datasets = map[string][]Dataset{
	"crm": {{"accounts", "crm_accounts", "Customers", nil}, {"contacts", "crm_contacts", "Contacts", nil}, {"leads", "crm_leads", "Leads", []string{"id", "name", "company", "status", "tax_id", "notes", "merged_into_id"}}, {"opportunities", "crm_opportunities", "Opportunities", nil}, {"stages", "crm_stages", "Pipeline stages", nil}, {"activities", "crm_activities", "Activities", nil}, {"tickets", "crm_tickets", "Support tickets", []string{"id", "subject", "status", "priority", "sla_hours", "created_at", "due_at", "paused_at", "sla_remaining_seconds"}}, {"quotes", "crm_quotes", "Quotes", nil}, {"quoteItems", "crm_quote_items", "Quote items", nil}},
}

func camel(s string) string {
	parts := strings.Split(s, "_")
	for i := 1; i < len(parts); i++ {
		if len(parts[i]) > 0 {
			parts[i] = strings.ToUpper(parts[i][:1]) + parts[i][1:]
		}
	}
	return strings.Join(parts, "")
}
func queryMaps(db *sql.DB, query string, args ...any) ([]map[string]any, error) {
	rows, e := db.Query(query, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	cols, e := rows.Columns()
	if e != nil {
		return nil, e
	}
	out := []map[string]any{}
	for rows.Next() {
		v := make([]any, len(cols))
		p := make([]any, len(cols))
		for i := range v {
			p[i] = &v[i]
		}
		if e = rows.Scan(p...); e != nil {
			return nil, e
		}
		m := map[string]any{}
		for i, c := range cols {
			if b, yes := v[i].([]byte); yes {
				v[i] = string(b)
			}
			m[camel(c)] = v[i]
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

func crmDatasetOwnerFilter(key string) (string, int) {
	switch key {
	case "opportunities":
		return " AND owner_id=?", 1
	case "quotes":
		return ` AND EXISTS (
			SELECT 1 FROM crm_opportunities o
			WHERE o.organization_id=crm_quotes.organization_id
			  AND o.id=crm_quotes.opportunity_id AND o.owner_id=?
		)`, 1
	case "quoteItems":
		return ` AND EXISTS (
			SELECT 1 FROM crm_quotes q
			JOIN crm_opportunities o ON o.organization_id=q.organization_id AND o.id=q.opportunity_id
			WHERE q.organization_id=crm_quote_items.organization_id
			  AND q.id=crm_quote_items.quote_id AND o.owner_id=?
		)`, 1
	case "activities":
		return ` AND owner_id=? AND (
			opportunity_id IS NULL OR EXISTS (
				SELECT 1 FROM crm_opportunities o
				WHERE o.organization_id=crm_activities.organization_id
				  AND o.id=crm_activities.opportunity_id AND o.owner_id=?
			)
		)`, 2
	case "accounts", "contacts", "leads", "stages", "tickets":
		// These remain organization-wide CRM workspaces in this authorization slice.
		return "", 0
	default:
		// Do not expose a newly added CRM dataset to individual roles before its
		// ownership policy has been reviewed.
		return " AND 1=0", 0
	}
}

func (a *App) stationAPI(w http.ResponseWriter, r *http.Request) {
	site, action := r.PathValue("site"), r.PathValue("action")
	if !knownSite(site) {
		fail(w, 404, "Workspace not found")
		return
	}
	id, e := a.identity(r)
	if e != nil {
		fail(w, 401, e.Error())
		return
	}
	g := id.grant(site)
	if g == nil {
		fail(w, 403, "No access to this workspace")
		return
	}
	if site == "crm" && action == "support" {
		a.crmSupport(w, r, id, g)
		return
	}
	if site == "crm" && action == "quotes" {
		a.crmQuotes(w, r, id, g)
		return
	}
	if action == "data" && r.Method == "GET" {
		front := r.URL.Query().Get("view") == "front"
		if !front && g.Scope != "back" {
			fail(w, 403, "Front-office accounts cannot read back-office data")
			return
		}
		out := map[string]any{}
		for _, d := range datasets[site] {
			if front && len(d.Front) == 0 {
				continue
			}
			columns := "*"
			if front {
				columns = strings.Join(d.Front, ",")
			}
			query := "SELECT " + columns + " FROM " + d.Table + " WHERE organization_id=?"
			args := []any{id.OrganizationID}
			if site == "crm" && !front && g.Role != "admin" {
				filter, count := crmDatasetOwnerFilter(d.Key)
				query += filter
				for i := 0; i < count; i++ {
					args = append(args, id.UserID)
				}
			}
			rows, err := queryMaps(a.db, query+" ORDER BY rowid DESC LIMIT 500", args...)
			if err != nil {
				fail(w, 500, "Unable to read workspace data: "+d.Key)
				return
			}
			if site == "crm" && d.Key == "tickets" {
				for _, row := range rows {
					status, _ := row["status"].(string)
					var due time.Time
					hasDue := false
					if dueStr, ok := row["dueAt"].(string); ok && dueStr != "" {
						if dParsed, err := time.Parse(time.RFC3339, dueStr); err == nil {
							due = dParsed
							hasDue = true
						}
					}
					if !hasDue {
						created, _ := row["createdAt"].(string)
						parsed, err := time.Parse(time.RFC3339, created)
						if err != nil {
							parsed, err = time.Parse("2006-01-02 15:04:05", created)
						}
						hours, valid := row["slaHours"].(int64)
						if err == nil && valid && hours >= 1 && hours <= 720 {
							due = crmSLADue(parsed, int(hours))
							row["dueAt"] = due.Format(time.RFC3339)
							hasDue = true
						}
					}
					if status == "pending_customer" || status == "resolved" {
						row["isSlaBreached"] = false
					} else if hasDue {
						row["isSlaBreached"] = time.Now().After(due)
					}
				}
			}
			out[d.Key] = rows
		}
		if site == "crm" && !front {
			rows, err := queryMaps(a.db, "SELECT c.contact_id,c.email FROM crm_consents c JOIN crm_contacts p ON p.id=c.contact_id AND p.organization_id=c.organization_id WHERE c.organization_id=? AND c.marketing_email_allowed=1 AND (c.status IS NULL OR c.status != 'revoked') ORDER BY c.rowid DESC LIMIT 500", id.OrganizationID)
			if err != nil {
				fail(w, 500, "Unable to read marketing consent")
				return
			}
			out["marketingRecipients"] = rows
		}
		ok(w, out)
		return
	}
	if site == "crm" && action == "opportunity-stage" && r.Method == http.MethodPost {
		a.opportunityStage(w, r, id, g)
		return
	}
	if site == "crm" && action == "leads" && r.Method == http.MethodPost {
		if !crmCanMutate(w, g) {
			return
		}
		createCRMLead(w, r, a, id)
		return
	}
	if site == "crm" && (action == "lead-duplicates" || action == "leads/duplicates") {
		a.crmLeadDuplicates(w, r, id, g)
		return
	}
	if site == "crm" && (action == "lead-merge" || action == "leads/merge") && r.Method == http.MethodPost {
		a.crmLeadMerge(w, r, id, g)
		return
	}
	if site == "crm" && action == "marketing-export" && r.Method == http.MethodGet {
		a.crmMarketingExport(w, r, id, g)
		return
	}
	if site == "crm" && (action == "lead-qualify" || action == "lead-convert") && r.Method == http.MethodPost {
		if !crmCanMutate(w, g) {
			return
		}
		if action == "lead-qualify" {
			qualifyCRMLead(w, r, a, id)
		} else {
			convertCRMLead(w, r, a, id)
		}
		return
	}
	if action == "users" {
		if g.Role != "admin" || g.Scope != "back" {
			fail(w, 403, "Only workspace administrators can manage accounts")
			return
		}
		if r.Method == "GET" {
			rows, e := queryMaps(a.db, `SELECT a.user_id,a.email,u.display_name,g.role,g.scope,g.enabled FROM station_accounts a JOIN users u ON u.id=a.user_id JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? AND g.site=?`, id.OrganizationID, site)
			if e != nil {
				fail(w, 500, "Unable to read accounts")
				return
			}
			ok(w, rows)
			return
		}
		if r.Method == "POST" {
			a.manageUser(w, r, id, site)
			return
		}
	}
	if action == "print" && r.Method == "GET" {
		if g.Scope != "back" {
			fail(w, 403, "Print center requires back-office access")
			return
		}
		a.printData(w, r, id, site)
		return
	}
	fail(w, 501, "This operation has not been migrated to Go. No changes were made")
}

func crmCanMutate(w http.ResponseWriter, g *Grant) bool {
	if g.Scope != "back" || (g.Role != "operator" && g.Role != "admin") {
		fail(w, http.StatusForbidden, "CRM lead operations require a back-office operator")
		return false
	}
	return true
}

var crmEmailPattern = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func createCRMLead(w http.ResponseWriter, r *http.Request, a *App, id *Identity) {
	var input struct {
		Name    string `json:"name"`
		Company string `json:"company"`
		Email   string `json:"email"`
		Phone   string `json:"phone"`
		TaxID   string `json:"taxId"`
		Notes   string `json:"notes"`
	}
	if body(r, &input) != nil {
		fail(w, 400, "Invalid lead data")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Company = strings.TrimSpace(input.Company)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.Phone = strings.TrimSpace(input.Phone)
	input.TaxID = strings.TrimSpace(input.TaxID)
	input.Notes = strings.TrimSpace(input.Notes)
	if input.Name == "" || len(input.Name) > 150 || len(input.Company) > 200 || !crmEmailPattern.MatchString(input.Email) || len(input.Email) > 254 || len(input.Phone) > 50 || len(input.TaxID) > 50 || len(input.Notes) > 5000 {
		fail(w, 400, "Provide a lead name and valid email; text fields exceed their limits")
		return
	}
	leadID := "lead:" + token()
	_, err := a.db.Exec(`INSERT INTO crm_leads(id,organization_id,name,company,email,phone,status,assigned_to,tax_id,notes) VALUES(?,?,?,?,?,?,'new',?,?,?)`, leadID, id.OrganizationID, input.Name, nullable(input.Company), input.Email, nullable(input.Phone), id.UserID, nullable(input.TaxID), nullable(input.Notes))
	if err != nil {
		fail(w, 409, "Unable to create lead")
		return
	}
	okStatus(w, http.StatusCreated, map[string]string{"id": leadID, "status": "new"})
}

func (a *App) crmLeadDuplicates(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if g.Role == "readonly" {
		fail(w, 403, "Write-enabled back-office access required")
		return
	}
	var input struct {
		LeadID string `json:"leadId"`
		Email  string `json:"email"`
		Phone  string `json:"phone"`
		TaxID  string `json:"taxId"`
	}
	if r.Method == http.MethodPost {
		_ = body(r, &input)
	} else if r.Method == http.MethodGet {
		input.LeadID = r.URL.Query().Get("leadId")
		input.Email = r.URL.Query().Get("email")
		input.Phone = r.URL.Query().Get("phone")
		input.TaxID = r.URL.Query().Get("taxId")
	} else {
		fail(w, 405, "Use GET or POST")
		return
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	input.Phone = strings.TrimSpace(input.Phone)
	input.TaxID = strings.TrimSpace(input.TaxID)
	input.LeadID = strings.TrimSpace(input.LeadID)

	if input.LeadID != "" {
		var lEmail, lPhone, lTaxID sql.NullString
		err := a.db.QueryRow("SELECT email, phone, tax_id FROM crm_leads WHERE organization_id=? AND id=?", id.OrganizationID, input.LeadID).Scan(&lEmail, &lPhone, &lTaxID)
		if err == nil {
			if input.Email == "" && lEmail.Valid {
				input.Email = strings.ToLower(strings.TrimSpace(lEmail.String))
			}
			if input.Phone == "" && lPhone.Valid {
				input.Phone = strings.TrimSpace(lPhone.String)
			}
			if input.TaxID == "" && lTaxID.Valid {
				input.TaxID = strings.TrimSpace(lTaxID.String)
			}
		}
	}

	if input.Email == "" && input.Phone == "" && input.TaxID == "" {
		ok(w, map[string]any{"duplicates": []any{}})
		return
	}

	query := `SELECT id, name, company, email, phone, tax_id, status FROM crm_leads WHERE organization_id=? AND status != 'merged' AND id != ? AND (`
	conds := []string{}
	args := []any{id.OrganizationID, input.LeadID}

	if input.Email != "" {
		conds = append(conds, "lower(email) = ?")
		args = append(args, input.Email)
	}
	if input.Phone != "" {
		conds = append(conds, "(phone IS NOT NULL AND phone != '' AND phone = ?)")
		args = append(args, input.Phone)
	}
	if input.TaxID != "" {
		conds = append(conds, "(tax_id IS NOT NULL AND tax_id != '' AND tax_id = ?)")
		args = append(args, input.TaxID)
	}

	query += strings.Join(conds, " OR ") + ") ORDER BY created_at DESC LIMIT 50"
	rows, err := queryMaps(a.db, query, args...)
	if err != nil {
		fail(w, 500, "Unable to query duplicates")
		return
	}
	ok(w, map[string]any{"duplicates": rows})
}

func (a *App) crmLeadMerge(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if r.Method != http.MethodPost {
		fail(w, 405, "Use POST")
		return
	}
	if !crmCanMutate(w, g) {
		return
	}
	var input struct {
		PrimaryLeadID   string `json:"primaryLeadId"`
		DuplicateLeadID string `json:"duplicateLeadId"`
		Key             string `json:"idempotencyKey"`
	}
	if body(r, &input) != nil || input.PrimaryLeadID == "" || input.DuplicateLeadID == "" || len(input.Key) < 8 || len(input.Key) > 128 {
		fail(w, 400, "A primaryLeadId, duplicateLeadId and idempotencyKey are required")
		return
	}
	if input.PrimaryLeadID == input.DuplicateLeadID {
		fail(w, 400, "Cannot merge a lead into itself")
		return
	}

	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 503, "CRM unavailable")
		return
	}
	defer tx.Rollback()

	raw, _ := json.Marshal(input)
	hash := digest(string(raw))
	endpoint := "/station/crm/lead-merge"
	var oldHash, oldBody string
	err = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", id.OrganizationID, input.Key, endpoint).Scan(&oldHash, &oldBody)
	if err == nil {
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
	if !errors.Is(err, sql.ErrNoRows) {
		fail(w, 503, "Cannot read retry state")
		return
	}

	var pStatus string
	var pNotes sql.NullString
	err = tx.QueryRow("SELECT status, notes FROM crm_leads WHERE organization_id=? AND id=?", id.OrganizationID, input.PrimaryLeadID).Scan(&pStatus, &pNotes)
	if err != nil {
		fail(w, 404, "Primary lead not found")
		return
	}
	if pStatus == "merged" {
		fail(w, 409, "Primary lead has already been merged")
		return
	}
	if pStatus == "converted" {
		fail(w, 409, "Primary lead has already been converted")
		return
	}

	var dStatus string
	var dNotes sql.NullString
	err = tx.QueryRow("SELECT status, notes FROM crm_leads WHERE organization_id=? AND id=?", id.OrganizationID, input.DuplicateLeadID).Scan(&dStatus, &dNotes)
	if err != nil {
		fail(w, 404, "Duplicate lead not found")
		return
	}
	if dStatus == "merged" {
		fail(w, 409, "Duplicate lead has already been merged")
		return
	}
	if dStatus == "converted" {
		fail(w, 409, "Duplicate lead has already been converted and cannot be merged")
		return
	}

	res, err := tx.Exec("UPDATE crm_activities SET lead_id=? WHERE organization_id=? AND lead_id=?", input.PrimaryLeadID, id.OrganizationID, input.DuplicateLeadID)
	if err != nil {
		fail(w, 500, "Failed to migrate activities")
		return
	}
	migratedCount, _ := res.RowsAffected()

	combinedNotes := pNotes.String
	if dNotes.Valid && strings.TrimSpace(dNotes.String) != "" {
		if strings.TrimSpace(combinedNotes) != "" {
			combinedNotes += "\n--- Merged from " + input.DuplicateLeadID + " ---\n" + dNotes.String
		} else {
			combinedNotes = "[Merged from " + input.DuplicateLeadID + "]: " + dNotes.String
		}
		_, err = tx.Exec("UPDATE crm_leads SET notes=? WHERE organization_id=? AND id=?", combinedNotes, id.OrganizationID, input.PrimaryLeadID)
		if err != nil {
			fail(w, 500, "Failed to update primary lead notes")
			return
		}
	}

	_, err = tx.Exec("UPDATE crm_leads SET status='merged', merged_into_id=? WHERE organization_id=? AND id=?", input.PrimaryLeadID, id.OrganizationID, input.DuplicateLeadID)
	if err != nil {
		fail(w, 500, "Failed to update duplicate lead status")
		return
	}

	result := map[string]any{
		"success":            true,
		"primaryLeadId":      input.PrimaryLeadID,
		"mergedLeadId":       input.DuplicateLeadID,
		"activitiesMigrated": migratedCount,
	}

	encoded, _ := json.Marshal(result)
	_, err = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", "idem_"+token(), id.OrganizationID, input.Key, endpoint, hash, string(encoded))
	if err == nil {
		_, err = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,?,?,'crm_lead',?,?)", "audit_"+token(), id.OrganizationID, id.UserID, g.Role, "crm.lead.merge", input.PrimaryLeadID, string(encoded))
	}
	if err != nil {
		fail(w, 503, "Cannot record audit or retry key")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 503, "Cannot commit merge transaction")
		return
	}
	ok(w, result)
}

func (a *App) crmMarketingExport(w http.ResponseWriter, r *http.Request, id *Identity, g *Grant) {
	if g.Scope != "back" {
		fail(w, 403, "Marketing export requires back-office access")
		return
	}
	rows, err := queryMaps(a.db, "SELECT c.contact_id, c.email, p.name, p.phone FROM crm_consents c JOIN crm_contacts p ON p.id=c.contact_id AND p.organization_id=c.organization_id WHERE c.organization_id=? AND c.marketing_email_allowed=1 AND (c.status IS NULL OR c.status != 'revoked') ORDER BY c.rowid DESC", id.OrganizationID)
	if err != nil {
		fail(w, 500, "Unable to export marketing recipients")
		return
	}
	ok(w, map[string]any{"marketingRecipients": rows})
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func qualifyCRMLead(w http.ResponseWriter, r *http.Request, a *App, id *Identity) {
	var input struct {
		LeadID string `json:"leadId"`
	}
	if body(r, &input) != nil || input.LeadID == "" {
		fail(w, 400, "A lead ID is required")
		return
	}
	result, err := a.db.Exec(`UPDATE crm_leads SET status='qualified' WHERE organization_id=? AND id=? AND status='new'`, id.OrganizationID, input.LeadID)
	if err != nil {
		fail(w, 500, "Unable to qualify lead")
		return
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		fail(w, 409, "Lead is missing or is not new")
		return
	}
	ok(w, map[string]string{"id": input.LeadID, "status": "qualified"})
}

func convertCRMLead(w http.ResponseWriter, r *http.Request, a *App, identity *Identity) {
	var input struct {
		LeadID    string `json:"leadId"`
		Amount    *int64 `json:"amount"`
		CloseDate string `json:"closeDate"`
	}
	if body(r, &input) != nil || input.LeadID == "" {
		fail(w, 400, "A lead ID, amount and close date are required")
		return
	}
	parsed, err := time.Parse("2006-01-02", input.CloseDate)
	if input.Amount == nil || *input.Amount < 0 || *input.Amount > 9007199254740991 || err != nil || parsed.Format("2006-01-02") != input.CloseDate {
		fail(w, 400, "Amount must be a non-negative integer and close date must be a valid YYYY-MM-DD date")
		return
	}
	amount := *input.Amount
	tx, err := a.db.Begin()
	if err != nil {
		fail(w, 503, "Unable to begin conversion")
		return
	}
	defer tx.Rollback()
	var name, email string
	var company, phone, assigned sql.NullString
	err = tx.QueryRow(`SELECT name,company,email,phone,assigned_to FROM crm_leads WHERE organization_id=? AND id=? AND status='qualified'`, identity.OrganizationID, input.LeadID).Scan(&name, &company, &email, &phone, &assigned)
	if err != nil {
		fail(w, 409, "Lead is missing or is not qualified")
		return
	}
	owner := assigned.String
	if owner == "" {
		owner = identity.UserID
	}
	var ownerCount int
	err = tx.QueryRow(`SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.user_id=? AND a.organization_id=? AND a.disabled=0 AND g.site='crm' AND g.enabled=1 AND g.scope='back' AND g.role IN ('admin','operator')`, owner, identity.OrganizationID).Scan(&ownerCount)
	if err != nil || ownerCount != 1 {
		fail(w, 400, "Lead owner is not an active back-office CRM user in this organization")
		return
	}
	var stageID string
	var probability int
	err = tx.QueryRow(`SELECT id,probability FROM crm_stages WHERE organization_id=? AND is_won=0 AND is_lost=0 ORDER BY position,id LIMIT 1`, identity.OrganizationID).Scan(&stageID, &probability)
	if err != nil || probability < 0 || probability > 100 {
		fail(w, 409, "No valid CRM opportunity stage is configured")
		return
	}
	claimed, err := tx.Exec(`UPDATE crm_leads SET status='converted' WHERE organization_id=? AND id=? AND status='qualified'`, identity.OrganizationID, input.LeadID)
	if err != nil {
		fail(w, 409, "Lead conversion could not be claimed")
		return
	}
	rows, _ := claimed.RowsAffected()
	if rows != 1 {
		fail(w, 409, "Lead has already been converted")
		return
	}
	companyName := company.String
	if companyName == "" {
		companyName = name
	}
	accountID, contactID, opportunityID := "lead-account:"+input.LeadID, "lead-contact:"+input.LeadID, "lead-opportunity:"+input.LeadID
	weighted := (amount*int64(probability) + 50) / 100
	if _, err = tx.Exec(`INSERT INTO crm_accounts(id,organization_id,name,email,phone,owner_id) VALUES(?,?,?,?,?,?)`, accountID, identity.OrganizationID, companyName, email, phone, owner); err == nil {
		_, err = tx.Exec(`INSERT INTO crm_contacts(id,organization_id,account_id,name,email,phone) VALUES(?,?,?,?,?,?)`, contactID, identity.OrganizationID, accountID, name, email, phone)
	}
	if err == nil {
		_, err = tx.Exec(`INSERT INTO crm_opportunities(id,organization_id,name,account_id,primary_contact_id,owner_id,stage_id,amount,weighted_amount,probability,close_date,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'open')`, opportunityID, identity.OrganizationID, companyName+" - Opportunity", accountID, contactID, owner, stageID, amount, weighted, probability, input.CloseDate)
	}
	if err == nil {
		_, err = tx.Exec(`UPDATE crm_leads SET converted_account_id=?,converted_contact_id=?,converted_opportunity_id=? WHERE organization_id=? AND id=? AND status='converted'`, accountID, contactID, opportunityID, identity.OrganizationID, input.LeadID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		fail(w, 409, "Conversion failed; no records were created")
		return
	}
	ok(w, map[string]string{"accountId": accountID, "contactId": contactID, "opportunityId": opportunityID})
}

func okStatus(w http.ResponseWriter, status int, data any) {
	writeJSON(w, status, map[string]any{"success": true, "data": data})
}
func (a *App) manageUser(w http.ResponseWriter, r *http.Request, id *Identity, site string) {
	var input struct {
		UserID   string `json:"userId"`
		Email    string `json:"email"`
		Name     string `json:"name"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Scope    string `json:"scope"`
		Enabled  bool   `json:"enabled"`
	}
	if body(r, &input) != nil || (input.Role != "admin" && input.Role != "operator" && input.Role != "readonly") || (input.Scope != "front" && input.Scope != "back") || (input.Role == "admin" && input.Scope != "back") {
		fail(w, 400, "Invalid account or permission data")
		return
	}
	if input.UserID == id.UserID {
		fail(w, 409, "Ask another administrator to change your own permissions")
		return
	}
	hash := ""
	var e error
	if input.UserID == "" {
		input.Email = strings.ToLower(strings.TrimSpace(input.Email))
		if !strings.Contains(input.Email, "@") || len(input.Email) > 254 || len(input.Name) == 0 || len(input.Name) > 80 || len(input.Password) < 12 || len(input.Password) > 256 {
			fail(w, 400, "Provide a name, email and password of at least 12 characters")
			return
		}
		hash, e = passwordHash(input.Password, "")
		if e != nil {
			fail(w, 500, "Password processing failed")
			return
		}
	}
	tx, e := a.db.Begin()
	if e != nil {
		fail(w, 503, "Unable to begin account transaction")
		return
	}
	defer tx.Rollback()
	target := input.UserID
	if target == "" {
		target = token()
		if _, e = tx.Exec("INSERT INTO users(id,email,display_name) VALUES(?,?,?)", target, input.Email, input.Name); e == nil {
			_, e = tx.Exec("INSERT INTO station_accounts(user_id,organization_id,email,password_hash) VALUES(?,?,?,?)", target, id.OrganizationID, input.Email, hash)
		}
	} else {
		var n int
		e = tx.QueryRow("SELECT count(*) FROM station_accounts WHERE user_id=? AND organization_id=?", target, id.OrganizationID).Scan(&n)
		if e == nil && n != 1 {
			e = errors.New("Account does not belong to this organization")
		}
	}
	if e == nil {
		_, e = tx.Exec(`INSERT INTO station_grants(user_id,site,role,scope,enabled) VALUES(?,?,?,?,?) ON CONFLICT(user_id,site) DO UPDATE SET role=excluded.role,scope=excluded.scope,enabled=excluded.enabled`, target, site, input.Role, input.Scope, input.Enabled)
	}
	if e == nil {
		audit, _ := json.Marshal(map[string]any{"site": site, "role": input.Role, "scope": input.Scope, "enabled": input.Enabled})
		_, e = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,after_value) VALUES(?,?,?,'admin','STATION_GRANT','ACCOUNT',?,?)", token(), id.OrganizationID, id.UserID, target, string(audit))
	}
	if e == nil {
		e = tx.Commit()
	}
	if e != nil {
		fail(w, 409, "Account update failed. Check email uniqueness and organization membership")
		return
	}
	ok(w, map[string]string{"userId": target})
}

type PrintKind struct{ Site, Dataset, Title, Lines, ForeignKey string }

var printKinds = map[string]PrintKind{
	"crm-account-label": {"crm", "accounts", "Customer label", "", ""}, "crm-quote": {"crm", "quotes", "Customer quote", "crm_quote_items", "quote_id"},
}

func (a *App) printData(w http.ResponseWriter, r *http.Request, id *Identity, site string) {
	kind, exists := printKinds[r.URL.Query().Get("kind")]
	if !exists || kind.Site != site {
		fail(w, 400, "Unsupported print format")
		return
	}
	recordID := r.URL.Query().Get("id")
	table := ""
	for _, d := range datasets[site] {
		if d.Key == kind.Dataset {
			table = d.Table
		}
	}
	query := "SELECT * FROM " + table + " WHERE organization_id=? AND id=?"
	args := []any{id.OrganizationID, recordID}
	if site == "crm" && kind.Dataset == "quotes" {
		if grant := id.grant(site); grant != nil && grant.Role != "admin" {
			query += ` AND EXISTS (
				SELECT 1 FROM crm_opportunities o
				WHERE o.organization_id=crm_quotes.organization_id
				  AND o.id=crm_quotes.opportunity_id AND o.owner_id=?
			)`
			args = append(args, id.UserID)
		}
	}
	rows, e := queryMaps(a.db, query, args...)
	if e != nil || len(rows) != 1 {
		fail(w, 404, "Document not found in this organization")
		return
	}
	lines := []map[string]any{}
	if kind.Lines != "" {
		lines, e = queryMaps(a.db, fmt.Sprintf("SELECT * FROM %s WHERE organization_id=? AND %s=?", kind.Lines, kind.ForeignKey), id.OrganizationID, recordID)
		if e != nil {
			fail(w, 500, "Unable to read document details")
			return
		}
	}
	ok(w, map[string]any{"title": kind.Title, "record": rows[0], "lines": lines, "printedBy": id.Name, "organizationId": id.OrganizationID})
}
