package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

type Dataset struct {
	Key, Table, Label string
	Front             []string
}

var datasets = map[string][]Dataset{
	"mes":    {{"products", "mes_products", "產品", []string{"id", "sku", "name", "unit", "status"}}, {"workOrders", "mes_work_orders", "生產工單", []string{"id", "order_no", "product_id", "status", "target_quantity", "completed_quantity", "scrapped_quantity"}}, {"lots", "mes_material_lots", "原物料批號", []string{"id", "lot_number", "material_sku", "current_quantity", "status"}}, {"reports", "mes_production_reports", "報工", []string{"id", "work_order_id", "good_quantity", "scrap_quantity", "created_at"}}, {"qualityChecks", "mes_quality_checks", "品檢", nil}, {"workCenters", "mes_work_centers", "工作中心", []string{"id", "code", "name", "status"}}, {"materials", "mes_work_order_materials", "領退料", nil}, {"bomVersions", "mes_bom_versions", "BOM 版本", nil}, {"bomItems", "mes_bom_items", "BOM 明細", nil}, {"downtimeEvents", "mes_downtime_events", "停機紀錄", nil}},
	"erp":    {{"items", "erp_items", "品項", []string{"id", "sku", "name", "unit", "is_active"}}, {"warehouses", "erp_warehouses", "倉庫", []string{"id", "name", "code"}}, {"stockLedger", "erp_stock_ledger", "庫存異動", []string{"id", "item_id", "warehouse_id", "quantity_change", "created_at"}}, {"purchaseOrders", "erp_purchase_orders", "採購單", nil}, {"purchaseLines", "erp_purchase_order_lines", "採購明細", nil}, {"salesOrders", "erp_sales_orders", "銷售單", nil}, {"salesLines", "erp_sales_order_lines", "銷售明細", nil}, {"receipts", "erp_receipts", "收貨單", nil}, {"receiptLines", "erp_receipt_lines", "收貨明細", nil}, {"invoices", "erp_invoices", "應收應付", nil}, {"suppliers", "erp_suppliers", "供應商", nil}, {"customers", "erp_customers", "客戶", nil}, {"journalEntries", "erp_journal_entries", "會計傳票", nil}, {"journalLines", "erp_journal_lines", "傳票明細", nil}},
	"pos":    {{"catalogItems", "pos_catalog_items", "商品", []string{"id", "name", "barcode", "price", "is_active"}}, {"sales", "pos_sales", "交易小票", []string{"id", "receipt_number", "total_amount", "payment_method", "created_at"}}, {"saleLines", "pos_sale_lines", "交易明細", nil}, {"stores", "pos_stores", "門市", []string{"id", "name", "code"}}, {"registers", "pos_registers", "收銀機", []string{"id", "name", "store_id"}}, {"shifts", "pos_shifts", "班結", nil}, {"heldCarts", "pos_held_carts", "掛單", nil}},
	"crm":    {{"accounts", "crm_accounts", "客戶", nil}, {"contacts", "crm_contacts", "聯絡人", nil}, {"leads", "crm_leads", "潛客", []string{"id", "name", "company", "status"}}, {"opportunities", "crm_opportunities", "商機", nil}, {"activities", "crm_activities", "跟進活動", nil}, {"tickets", "crm_tickets", "服務案件", []string{"id", "subject", "status", "priority", "created_at"}}, {"quotes", "crm_quotes", "報價單", nil}, {"quoteItems", "crm_quote_items", "報價明細", nil}},
	"dining": {{"tables", "dining_tables", "桌位", []string{"id", "table_number", "capacity", "status"}}, {"orders", "dining_orders", "點餐單", []string{"id", "takeout_number", "status", "created_at"}}, {"orderItems", "dining_order_items", "餐點明細", nil}, {"menuItems", "dining_menu_items", "菜單", []string{"id", "name", "price", "category", "is_sold_out"}}, {"bills", "dining_bills", "帳單", nil}, {"reservations", "dining_reservations", "訂位", nil}},
	"shop":   {{"products", "shop_products", "商品", []string{"id", "name", "slug", "description", "is_active"}}, {"variants", "shop_variants", "商品規格", []string{"id", "product_id", "sku", "title", "price", "stock_quantity"}}, {"orders", "shop_orders", "訂單", []string{"id", "order_number", "fulfillment_status", "payment_status", "total_amount", "created_at"}}, {"items", "shop_order_items", "訂單明細", nil}, {"returns", "shop_returns", "退貨", nil}, {"reviews", "shop_reviews", "評論", nil}},
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
func (a *App) stationAPI(w http.ResponseWriter, r *http.Request) {
	site, action := r.PathValue("site"), r.PathValue("action")
	if !knownSite(site) {
		fail(w, 404, "站台不存在")
		return
	}
	id, e := a.identity(r)
	if e != nil {
		fail(w, 401, e.Error())
		return
	}
	g := id.grant(site)
	if g == nil {
		fail(w, 403, "沒有此站台授權")
		return
	}
	if action == "data" && r.Method == "GET" {
		front := r.URL.Query().Get("view") == "front"
		if !front && g.Scope != "back" {
			fail(w, 403, "前台帳號不能讀取後台資料")
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
			if front && site == "pos" && d.Key == "sales" {
				query += " AND cashier_id=?"
				args = append(args, id.UserID)
			}
			if front && site == "shop" && d.Key == "orders" {
				query += " AND user_id=?"
				args = append(args, id.UserID)
			}
			rows, err := queryMaps(a.db, query+" ORDER BY rowid DESC LIMIT 500", args...)
			if err != nil {
				fail(w, 500, "站台資料讀取失敗："+d.Key)
				return
			}
			out[d.Key] = rows
		}
		ok(w, out)
		return
	}
	if action == "users" {
		if g.Role != "admin" || g.Scope != "back" {
			fail(w, 403, "只有該站管理員可管理帳號")
			return
		}
		if r.Method == "GET" {
			rows, e := queryMaps(a.db, `SELECT a.user_id,a.email,u.display_name,g.role,g.scope,g.enabled FROM station_accounts a JOIN users u ON u.id=a.user_id JOIN station_grants g ON g.user_id=a.user_id WHERE a.organization_id=? AND g.site=?`, id.OrganizationID, site)
			if e != nil {
				fail(w, 500, "無法讀取帳號")
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
			fail(w, 403, "列印中心需要後台授權")
			return
		}
		a.printData(w, r, id, site)
		return
	}
	fail(w, 501, "此業務操作尚未移植至 Go；未執行任何變更")
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
		fail(w, 400, "帳號或授權格式無效")
		return
	}
	if input.UserID == id.UserID {
		fail(w, 409, "不可變更自己的管理權限，請由另一位管理員操作")
		return
	}
	hash := ""
	var e error
	if input.UserID == "" {
		input.Email = strings.ToLower(strings.TrimSpace(input.Email))
		if !strings.Contains(input.Email, "@") || len(input.Email) > 254 || len(input.Name) == 0 || len(input.Name) > 80 || len(input.Password) < 12 || len(input.Password) > 256 {
			fail(w, 400, "請提供名稱、Email 與至少 12 字元密碼")
			return
		}
		hash, e = passwordHash(input.Password, "")
		if e != nil {
			fail(w, 500, "密碼處理失敗")
			return
		}
	}
	tx, e := a.db.Begin()
	if e != nil {
		fail(w, 503, "無法開始帳號交易")
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
			e = errors.New("帳號不在目前組織")
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
		fail(w, 409, "帳號變更未完成，請確認 Email 未重複且帳號屬於目前組織")
		return
	}
	ok(w, map[string]string{"userId": target})
}

type PrintKind struct{ Site, Dataset, Title, Lines, ForeignKey string }

var printKinds = map[string]PrintKind{
	"mes-lot-label": {"mes", "lots", "原物料標籤", "", ""}, "mes-order-label": {"mes", "workOrders", "工單標籤", "", ""}, "mes-order": {"mes", "workOrders", "生產工單", "mes_work_order_materials", "work_order_id"}, "mes-report": {"mes", "reports", "生產報工單", "", ""},
	"erp-item-label": {"erp", "items", "品項標籤", "", ""}, "erp-purchase": {"erp", "purchaseOrders", "採購單", "erp_purchase_order_lines", "po_id"}, "erp-sale": {"erp", "salesOrders", "銷售單", "erp_sales_order_lines", "so_id"}, "erp-receipt": {"erp", "receipts", "收貨單", "erp_receipt_lines", "receipt_id"},
	"pos-item-label": {"pos", "catalogItems", "商品標籤", "", ""}, "pos-receipt": {"pos", "sales", "交易小票", "pos_sale_lines", "sale_id"}, "pos-shift": {"pos", "shifts", "交班報表", "pos_sales", "shift_id"},
	"crm-account-label": {"crm", "accounts", "客戶識別標籤", "", ""}, "crm-quote": {"crm", "quotes", "客戶報價單", "crm_quote_items", "quote_id"},
	"dining-menu-label": {"dining", "menuItems", "餐點標籤", "", ""}, "dining-order": {"dining", "orders", "餐飲訂單", "dining_order_items", "order_id"},
	"shop-product-label": {"shop", "variants", "商品規格標籤", "", ""}, "shop-order": {"shop", "orders", "電商訂單", "shop_order_items", "order_id"},
}

func (a *App) printData(w http.ResponseWriter, r *http.Request, id *Identity, site string) {
	kind, exists := printKinds[r.URL.Query().Get("kind")]
	if !exists || kind.Site != site {
		fail(w, 400, "不支援的列印格式")
		return
	}
	recordID := r.URL.Query().Get("id")
	table := ""
	for _, d := range datasets[site] {
		if d.Key == kind.Dataset {
			table = d.Table
		}
	}
	rows, e := queryMaps(a.db, "SELECT * FROM "+table+" WHERE organization_id=? AND id=?", id.OrganizationID, recordID)
	if e != nil || len(rows) != 1 {
		fail(w, 404, "找不到目前組織的列印單據")
		return
	}
	lines := []map[string]any{}
	if kind.Lines != "" {
		lines, e = queryMaps(a.db, fmt.Sprintf("SELECT * FROM %s WHERE organization_id=? AND %s=?", kind.Lines, kind.ForeignKey), id.OrganizationID, recordID)
		if e != nil {
			fail(w, 500, "無法讀取單據明細")
			return
		}
	}
	ok(w, map[string]any{"title": kind.Title, "record": rows[0], "lines": lines, "printedBy": id.Name, "organizationId": id.OrganizationID})
}
