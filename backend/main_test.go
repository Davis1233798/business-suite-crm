package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func appForTest(t *testing.T) *App {
	t.Helper()
	db, e := openDB(filepath.Join(t.TempDir(), "suite.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	return &App{db: db}
}
func request(a *App, method, path string, input any, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	b, _ := json.Marshal(input)
	r := httptest.NewRequest(method, "http://localhost"+path, bytes.NewReader(b))
	r.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		r.AddCookie(c)
	}
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	return w
}
func login(t *testing.T, a *App, email, space string) []*http.Cookie {
	return loginSite(t, a, email, space, "mes")
}
func loginSite(t *testing.T, a *App, email, space, site string) []*http.Cookie {
	t.Helper()
	w := request(a, "POST", "/api/auth/login", map[string]string{"email": email, "password": testPassword, "site": site}, &http.Cookie{Name: demoCookie, Value: space})
	if w.Code != 200 {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	return w.Result().Cookies()
}
func TestSchemaDatasetAndPrintContracts(t *testing.T) {
	a := appForTest(t)
	for site, sets := range datasets {
		for _, d := range sets {
			cols := "*"
			if len(d.Front) > 0 {
				cols = ""
				for i, c := range d.Front {
					if i > 0 {
						cols += ","
					}
					cols += c
				}
			}
			if _, e := queryMaps(a.db, "SELECT "+cols+" FROM "+d.Table+" WHERE organization_id=?", "none"); e != nil {
				t.Errorf("%s/%s: %v", site, d.Key, e)
			}
		}
	}
	for key, k := range printKinds {
		if k.Lines != "" {
			if _, e := queryMaps(a.db, "SELECT * FROM "+k.Lines+" WHERE organization_id=? AND "+k.ForeignKey+"=?", "none", "none"); e != nil {
				t.Errorf("print %s: %v", key, e)
			}
		}
	}
}
func TestLoginScopeTamperingRevocationIsolation(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := login(t, a, "admin@suite.test", space)
	front := login(t, a, "front@suite.test", space)
	if w := request(a, "GET", "/api/stations/mes/data", nil, front...); w.Code != 403 {
		t.Fatal("front accessed back office", w.Code)
	}
	if w := request(a, "GET", "/api/stations/mes/data?view=front", nil, front...); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	tampered := append(front, &http.Cookie{Name: "demo_user_role", Value: "admin"})
	if w := request(a, "GET", "/api/stations/mes/users", nil, tampered...); w.Code != 403 {
		t.Fatal("role cookie elevated permissions")
	}
	if w := request(a, "GET", "/api/stations/mes/data", nil); w.Code != 401 {
		t.Fatal("anonymous accepted")
	}
	other := login(t, a, "admin@suite.test", token())
	w := request(a, "GET", "/api/auth/me", nil, other...)
	var doc struct {
		Data Identity `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &doc)
	otherID := doc.Data.UserID
	w = request(a, "POST", "/api/stations/mes/users", map[string]any{"userId": otherID, "role": "readonly", "scope": "back", "enabled": true}, admin...)
	if w.Code != 409 {
		t.Fatal("cross organization grant accepted", w.Code)
	}
	w = request(a, "GET", "/api/auth/me", nil, front...)
	json.Unmarshal(w.Body.Bytes(), &doc)
	frontID := doc.Data.UserID
	w = request(a, "POST", "/api/stations/mes/users", map[string]any{"userId": frontID, "role": "operator", "scope": "front", "enabled": false}, admin...)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w = request(a, "GET", "/api/stations/mes/data?view=front", nil, front...); w.Code != 403 {
		t.Fatal("revocation was not immediate")
	}
	request(a, "POST", "/api/auth/logout", map[string]any{}, admin...)
	if w = request(a, "GET", "/api/auth/me", nil, admin...); w.Code != 401 {
		t.Fatal("revoked session accepted")
	}
}
func TestOriginAndPassword(t *testing.T) {
	a := appForTest(t)
	r := httptest.NewRequest("POST", "http://localhost/api/auth/logout", nil)
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	a.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("CSRF accepted")
	}
	h, e := passwordHash("long-password", "")
	if e != nil || !passwordOK("long-password", h) || passwordOK("bad", h) {
		t.Fatal("password verification failed")
	}
}

func TestFrontDataAndPrintTenantBoundaries(t *testing.T) {
	a := appForTest(t)
	space := token()
	admin := login(t, a, "admin@suite.test", space)
	front := login(t, a, "front@suite.test", space)
	erpFront := loginSite(t, a, "front@suite.test", space, "erp")
	w := request(a, "GET", "/api/stations/erp/data?view=front", nil, erpFront...)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var doc struct {
		Data map[string]any `json:"data"`
	}
	json.Unmarshal(w.Body.Bytes(), &doc)
	if _, exists := doc.Data["invoices"]; exists {
		t.Fatal("finance leaked to front")
	}
	if len(doc.Data["items"].([]any)) == 0 {
		t.Fatal("fictional ERP fixture missing")
	}
	w = request(a, "GET", "/api/stations/mes/data", nil, admin...)
	json.Unmarshal(w.Body.Bytes(), &doc)
	lots := doc.Data["lots"].([]any)
	lot := lots[0].(map[string]any)["id"].(string)
	if w = request(a, "GET", "/api/stations/mes/print?kind=mes-lot-label&id="+lot, nil, admin...); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w = request(a, "GET", "/api/stations/mes/print?kind=mes-lot-label&id="+lot, nil, front...); w.Code != 403 {
		t.Fatal("front printed back office document")
	}
	other := login(t, a, "admin@suite.test", token())
	if w = request(a, "GET", "/api/stations/mes/print?kind=mes-lot-label&id="+lot, nil, other...); w.Code != 404 {
		t.Fatal("cross tenant document leaked")
	}
}
func TestAdditionalStationPrintsRequireAuthorizationAndStayInTenant(t *testing.T) {
	a := appForTest(t)
	space := token()
	otherSpace := token()
	for _, tc := range []struct{ site, dataset, kind string }{
		{"crm", "accounts", "crm-account-label"}, {"crm", "quotes", "crm-quote"},
		{"dining", "menuItems", "dining-menu-label"}, {"dining", "orders", "dining-order"},
		{"shop", "variants", "shop-product-label"}, {"shop", "orders", "shop-order"},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			admin := loginSite(t, a, "admin@suite.test", space, tc.site)
			front := loginSite(t, a, "front@suite.test", space, tc.site)
			other := loginSite(t, a, "admin@suite.test", otherSpace, tc.site)
			w := request(a, "GET", "/api/stations/"+tc.site+"/data?view=back", nil, admin...)
			var result struct {
				Data map[string][]map[string]any `json:"data"`
			}
			if w.Code != 200 {
				t.Fatal(w.Body.String())
			}
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			rows := result.Data[tc.dataset]
			if len(rows) == 0 {
				t.Fatalf("missing fixture: %s", tc.dataset)
			}
			path := "/api/stations/" + tc.site + "/print?kind=" + tc.kind + "&id=" + rows[0]["id"].(string)
			if w = request(a, "GET", path, nil, admin...); w.Code != 200 {
				t.Fatalf("admin: %d %s", w.Code, w.Body.String())
			}
			if w = request(a, "GET", path, nil, front...); w.Code != 403 {
				t.Fatalf("front: %d", w.Code)
			}
			if w = request(a, "GET", path, nil, other...); w.Code != 404 {
				t.Fatalf("other tenant: %d", w.Code)
			}
		})
	}
}

func TestPreviewFramePolicy(t *testing.T) {
	a := appForTest(t)
	for _, tc := range []struct{ path, policy string }{
		{"/mes/front?preview=mobile", "frame-ancestors 'self'"},
		{"/mes/back?preview=workspace", "frame-ancestors 'self'"},
		{"/mes/front", "frame-ancestors 'none'"},
		{"/mes/users?preview=mobile", "frame-ancestors 'none'"},
		{"/api/auth/me?preview=mobile", "frame-ancestors 'none'"},
	} {
		w := request(a, "GET", tc.path, nil)
		if !strings.Contains(w.Header().Get("Content-Security-Policy"), tc.policy) {
			t.Errorf("%s: %s", tc.path, w.Header().Get("Content-Security-Policy"))
		}
	}
}

func TestIndependentStationSessions(t *testing.T) {
	a := appForTest(t)
	space := token()
	mes := loginSite(t, a, "admin@suite.test", space, "mes")
	erp := loginSite(t, a, "front@suite.test", space, "erp")
	both := append(append([]*http.Cookie{}, mes...), erp...)
	if w := request(a, "GET", "/api/stations/mes/data?view=back", nil, both...); w.Code != 200 {
		t.Fatalf("MES admin: %d", w.Code)
	}
	if w := request(a, "GET", "/api/stations/erp/data?view=back", nil, both...); w.Code != 403 {
		t.Fatalf("ERP front: %d", w.Code)
	}
	if w := request(a, "POST", "/api/auth/logout?site=erp", map[string]any{}, both...); w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if w := request(a, "GET", "/api/stations/mes/data?view=back", nil, both...); w.Code != 200 {
		t.Fatalf("ERP logout affected MES: %d", w.Code)
	}
	if w := request(a, "GET", "/api/stations/erp/data?view=front", nil, both...); w.Code != 401 {
		t.Fatalf("ERP remained logged in: %d", w.Code)
	}
}
