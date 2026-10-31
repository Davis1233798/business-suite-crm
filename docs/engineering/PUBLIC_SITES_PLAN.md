# 各站公開網址配置（待選定主網域）

**主網域已選定：`blockchen.duckdns.org`。現行 Caddy 根站直接使用 `BASE_DOMAIN`（不加 suite 前綴），七個分站子域已解析。release 18 部署與 OCI 入站問題見 `DUCKDNS_DEPLOYMENT.md`；下列原先的註冊／新增 A 記錄計畫已由使用者現有 DuckDNS 指向取代。**

原始需求包含主站、MES、ERP、POS、CRM、餐飲、電商與電商後台的獨立網址。新增的 `infra/linux/compose.public-sites.yaml`、`Caddyfile.sites` 與 `apply.sh --public-sites` 已準備；目前沒有套用此 overlay，沒有建立 DNS 或開啟公開入口。

設定 `BASE_DOMAIN` 後新增下列 A 記錄，指向既有主機 `oci-jkes-1` 的公開 IPv4（目前 SSH 目標為 `150.230.2.37`）。不修改主網域既有根記錄、名稱伺服器或其他網站。套用前須再次確認主機 IP 與每筆 DNS。

| 新增名稱 | 首頁路徑 |
|---|---|
| suite.BASE_DOMAIN | `/`；IaC 控制台 `/platform` |
| mes.BASE_DOMAIN | `/mes` |
| erp.BASE_DOMAIN | `/erp` |
| pos.BASE_DOMAIN | `/pos` |
| crm.BASE_DOMAIN | `/crm` |
| dining.BASE_DOMAIN | `/dining` |
| shop.BASE_DOMAIN | `/shop` |
| commerce.BASE_DOMAIN | `/commerce` |

各主機根路徑以 302 導向對應工作區；所有站仍使用既有主站路由器轉送至獨立分站程序，保留跨站相對連結。這是每站獨立進入網址，不是以 hostname 作為資料授權界線。展示 session cookie 維持 host-only，不會自動將現有 SSH 預覽或不同網域的展示資料合併。

已驗證：Compose config；官方 Caddy 2.10 容器的真實 Caddyfile adapter；轉換結果包含八個預期 hostname、七個正確首頁 redirect、主站 router upstream 與 `/api/platform/dispatch` 的公開拒絕。來源依 [Caddy 環境變數與 site block 文件](https://caddyserver.com/docs/caddyfile/concepts)。

待使用者選擇網域方案後，才建立相應 DNS、設定受保護部署環境的 `BASE_DOMAIN`、發布包含新 overlay 的版本並啟用自動 HTTPS。當前已驗證發布 `20261030-16` 沒有開啟公開 edge。啟用後須逐一驗證八站的 DNS、有效 TLS、首頁與業務 API、控制權限及內部派送端點拒絕，不能僅以容器 running 宣稱公開部署完成。

## 主機部署前檢查

2026-10-30：已封裝並上傳至 `/srv/business-suite/releases/20261030-17`，套件 SHA256 `e51250ca72c85b86ca2e986d3e36547edeb6b02ee4affd0b42da51c68bbfbce0`。既有 ARM64 主機的 Compose config 與官方 Caddy 2.10 `validate` 均通過；驗證容器使用 `--network none`，沒有發布主機連接埠、建立 DNS 或取得真實網域憑證。收據 `/srv/business-suite/shared/public-ready-17.log`。

目前 `current` 仍指向已驗證的 `20261030-16`，17 個原有服務繼續運作；沒有啟動 edge。待正確 DNS 管理權限可用後，17 版才用於正式公開入口部署。
