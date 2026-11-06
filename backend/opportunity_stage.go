package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"
)

type opportunityStageInput struct {
	OpportunityID   string `json:"opportunityId"`
	ExpectedStageID string `json:"expectedStageId"`
	StageID         string `json:"stageId"`
	Reason          string `json:"reason"`
	RequestID       string `json:"requestId"`
}

func (a *App) opportunityStage(w http.ResponseWriter, r *http.Request, identity *Identity, grant *Grant) {
	if !crmCanMutate(w, grant) {
		return
	}
	var input opportunityStageInput
	if body(r, &input) != nil {
		fail(w, 400, "Invalid opportunity stage request")
		return
	}
	input.Reason = strings.TrimSpace(input.Reason)
	if len(input.RequestID) < 8 || len(input.RequestID) > 128 || input.OpportunityID == "" || len(input.OpportunityID) > 256 || input.ExpectedStageID == "" || len(input.ExpectedStageID) > 256 || input.StageID == "" || len(input.StageID) > 256 || !utf8.ValidString(input.Reason) || utf8.RuneCountInString(input.Reason) > 500 {
		fail(w, 400, "Enter bounded opportunity, stage, reason and retry details")
		return
	}
	raw, _ := json.Marshal(input)
	hash := digest(identity.UserID + "\x00" + string(raw))
	const endpoint = "/station/crm/opportunity-stage"
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		fail(w, 503, "Opportunity pipeline unavailable")
		return
	}
	defer tx.Rollback()
	var oldHash, cached string
	err = tx.QueryRow("SELECT request_hash,response_body FROM idempotency_keys WHERE organization_id=? AND key=? AND endpoint=?", identity.OrganizationID, input.RequestID, endpoint).Scan(&oldHash, &cached)
	if err == nil {
		if oldHash != hash {
			fail(w, 409, "Retry key already used for different input or account")
			return
		}
		var result map[string]any
		if json.Unmarshal([]byte(cached), &result) != nil {
			fail(w, 503, "Invalid stored pipeline result")
			return
		}
		ok(w, result)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		fail(w, 503, "Cannot read pipeline retry state")
		return
	}
	var currentStage, status, owner string
	var amount, oldWeighted int64
	var oldProbability int
	var oldWon, oldLost sql.NullString
	err = tx.QueryRow("SELECT stage_id,status,owner_id,amount,weighted_amount,probability,won_reason,loss_reason FROM crm_opportunities WHERE organization_id=? AND id=?", identity.OrganizationID, input.OpportunityID).Scan(&currentStage, &status, &owner, &amount, &oldWeighted, &oldProbability, &oldWon, &oldLost)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Opportunity not found")
		return
	}
	if err != nil {
		fail(w, 503, "Cannot read opportunity")
		return
	}
	if currentStage != input.ExpectedStageID {
		fail(w, 409, "Opportunity stage changed; reload before trying again")
		return
	}
	if currentStage == input.StageID {
		fail(w, 409, "Choose a different target stage")
		return
	}
	if amount < 0 || amount > 9007199254740991 || (status != "open" && status != "won" && status != "lost") {
		fail(w, 409, "Opportunity has unsupported money or state")
		return
	}
	var owners int
	err = tx.QueryRow("SELECT count(*) FROM station_accounts a JOIN station_grants g ON g.user_id=a.user_id WHERE a.user_id=? AND a.organization_id=? AND a.disabled=0 AND g.site='crm' AND g.enabled=1 AND g.scope='back' AND g.role IN ('admin','operator')", owner, identity.OrganizationID).Scan(&owners)
	if err != nil {
		fail(w, 503, "Cannot verify opportunity owner")
		return
	}
	if owners != 1 {
		fail(w, 409, "Opportunity owner is not active in this CRM workspace")
		return
	}
	var probability, won, lost int
	err = tx.QueryRow("SELECT probability,is_won,is_lost FROM crm_stages WHERE organization_id=? AND id=?", identity.OrganizationID, input.StageID).Scan(&probability, &won, &lost)
	if errors.Is(err, sql.ErrNoRows) {
		fail(w, 404, "Target stage not found")
		return
	}
	if err != nil {
		fail(w, 503, "Cannot read target stage")
		return
	}
	if probability < 0 || probability > 100 || (won != 0 && won != 1) || (lost != 0 && lost != 1) || (won == 1 && lost == 1) || (won == 1 && probability != 100) || (lost == 1 && probability != 0) {
		fail(w, 409, "Target stage has inconsistent probability or outcome")
		return
	}
	next := "open"
	var wonReason, lostReason any
	if won == 1 || lost == 1 {
		if input.Reason == "" {
			fail(w, 400, "A closing reason is required")
			return
		}
		if won == 1 {
			next = "won"
			wonReason = input.Reason
		} else {
			next = "lost"
			lostReason = input.Reason
		}
	}
	weighted := (amount*int64(probability) + 50) / 100
	changed, err := tx.Exec("UPDATE crm_opportunities SET stage_id=?,probability=?,weighted_amount=?,status=?,won_reason=?,loss_reason=? WHERE organization_id=? AND id=? AND stage_id=?", input.StageID, probability, weighted, next, wonReason, lostReason, identity.OrganizationID, input.OpportunityID, input.ExpectedStageID)
	if err != nil {
		fail(w, 503, "Pipeline update failed; no changes were saved")
		return
	}
	n, err := changed.RowsAffected()
	if err != nil || n != 1 {
		fail(w, 409, "Opportunity stage changed concurrently")
		return
	}
	before, _ := json.Marshal(map[string]any{"stageId": currentStage, "status": status, "probability": oldProbability, "weightedAmount": oldWeighted, "wonReason": oldWon.String, "lossReason": oldLost.String})
	result := map[string]any{"opportunityId": input.OpportunityID, "stageId": input.StageID, "status": next, "probability": probability, "weightedAmount": weighted, "wonReason": wonReason, "lossReason": lostReason}
	after, _ := json.Marshal(result)
	_, err = tx.Exec("INSERT INTO audit_events(id,organization_id,actor_id,actor_role,action,entity_type,entity_id,before_value,after_value,reason,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)", token(), identity.OrganizationID, identity.UserID, grant.Role, "crm.opportunity.stage", "CRM_OPPORTUNITY", input.OpportunityID, string(before), string(after), input.Reason, input.RequestID)
	if err == nil {
		_, err = tx.Exec("INSERT INTO idempotency_keys(id,organization_id,key,endpoint,request_hash,response_status,response_body) VALUES(?,?,?,?,?,200,?)", token(), identity.OrganizationID, input.RequestID, endpoint, hash, string(after))
	}
	if err != nil {
		fail(w, 503, "Pipeline transaction failed; no changes were saved")
		return
	}
	if err = tx.Commit(); err != nil {
		fail(w, 503, "Cannot commit opportunity stage")
		return
	}
	ok(w, result)
}
