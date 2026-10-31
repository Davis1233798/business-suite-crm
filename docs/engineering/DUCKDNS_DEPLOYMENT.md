# blockchen.duckdns.org 部署紀錄

使用者於 2026-10-30 指定沿用本機 SSH `oci-jkes-1`，並已將 `blockchen.duckdns.org` 指向該主機。此選擇取代先前 DigitalPlat／Cloudflare 網域方案，不再需要登入 Cloudflare 或註冊新網域。

## 已完成

- **2026-10-31（Asia/Taipei）公開驗收完成**：使用者放行網路後，外部 HTTP 已回 308；強制重新載入既有 Caddy 配置，八個網域均以正常 TLS 驗證成功開啟（最終頁面 HTTP 200，未停用憑證驗證）。八站 health 200、公開 dispatch 404、無憑證 control status 401；獨立操作憑證透過公開 HTTPS 查詢控制狀態 200。Cookie 均為 Secure、HttpOnly、SameSite=Lax。收據 `outputs/public-https-verification.json`，公開 MES／Platform 已以瀏覽器驗證。現為 17 個業務／資料容器加 1 個運行中的 Caddy；不再等待 OCI 規則或登入。

- DNS：根域與 mes、erp、pos、crm、dining、shop、commerce 七個子網域均實測解析為 `150.230.2.37`。
- 主機：OCI Osaka `ap-osaka-1`，實例顯示名稱 `oci-arm-joi-1`；SSH 別名 `oci-jkes-1`。
- 發布：`/srv/business-suite/current` → `/srv/business-suite/releases/20261030-18`。套件 SHA256 `31973729d1ac7dba43fcaa94188a922f145d22724cddd001f36ea129605b52fb`。現有持久 volumes 與憑證保留。
- 受保護的部署環境已設 `BASE_DOMAIN=blockchen.duckdns.org`，Caddy 根站使用根域，分站根路徑導向各工作區。
- `apply.sh --public-sites` 執行完成，資料服務 smoke 通過；原有 17 個業務／資料容器運行，loopback Web 健康檢查回 200。
- Caddy 曾啟動於 80／443；主機本機 HTTP 測試回 308。外部 HTTP／HTTPS 連線逾時，ACME HTTP-01 亦回報 connection timeout。公開憑證尚未取得。
- 以獨立、僅綁定 loopback 的 HTTP 測試容器測試同一份 Caddy 配置，八站均通過首頁（根站 200，其餘 302 至指定路徑）、後端 health 200、公開 dispatch 404、無操作憑證的控制 API 401。測試容器已停止並移除，沒有替代正式 HTTPS。工具位於主機 `/srv/business-suite/shared/smoke-public-edge.py`。

## 歷史阻塞（已排除）

2026-10-30 15:54 UTC 再驗證：使用者通知設定完成後，已重新啟動原有 `business-suite-edge-1`，未重建資料 volumes。主機本機入口 HTTP 308；MES 與 Platform 私有頁面均 200。外部以網域與直接 IP（停用 HTTP proxy）測試 TCP 80 仍連線逾時；同步主機 tcpdump 未擷取到該次 TCP 80 SYN。Let’s Encrypt 再次回報 HTTP-01 connect timeout，公開 TLS 驗收仍未完成。入口目前保持運行，由 Caddy 自動退避重試；不能以重新啟動成功取代外部可達驗收。

主機 Docker NAT／轉送包含 80、443 的允許規則，但外部連入仍逾時；需要檢查 OCI 適用的 Security List／NSG 入站設定。主機既有 instance principal 的網路唯讀 API 回 `404 NotAuthorizedOrNotFound`，本機及主機都沒有現成 OCI user config。沒有建立或擴大任何 IAM 政策。

已開啟 Oracle Cloud 租戶 `jkes6203` 的登入頁，等待使用者登入，或由使用者在此主機適用的安全清單／NSG 放行 TCP 80、443（來源 `0.0.0.0/0`、來源埠任意、stateful，保留原有規則）。未能讀取雲端規則前，不宣稱已證實是哪一條規則阻擋。

Caddy `business-suite-edge-1` 先前暫停後，現已依使用者要求重新啟動；其餘服務與 SSH 私有預覽正常。仍需確認實際套用於本機 VNIC／子網路的入站規則，待外部可達後，從外部逐一驗證八站 TLS、API 與權限，再完成公開部署驗收。不可把套件已部署或私有路由通過，當成公開 HTTPS 已完成。
