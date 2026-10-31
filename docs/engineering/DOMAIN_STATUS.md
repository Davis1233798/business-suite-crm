# 網域工作狀態

**2026-10-31（Asia/Taipei）更新：根域與 mes／erp／pos／crm／dining／shop／commerce 七個子域的公開 HTTPS、首頁與 API 權限檢查全部通過。先前入站網路阻塞已排除，詳見 `DUCKDNS_DEPLOYMENT.md`。下列等待網路文字均為歷史紀錄。**

**最新狀態：使用者已指定 `blockchen.duckdns.org` 並指向 `oci-jkes-1`。根域與七個子域 DNS 已驗證；release 18 已部署，八站私有入口測試通過。公開 HTTPS 目前等待 OCI 入站網路存取／80、443 可達，詳見 `DUCKDNS_DEPLOYMENT.md`。下列 DigitalPlat／Cloudflare 紀錄為歷史方案，不再是待辦或阻塞。**

2026-10-30：用戶指定可使用其 Google 帳號註冊 dpdns.org，並要求各網站有各自的網址。後續另要求優先調整目前 `/platform` 的外觀；該頁已更新至 `20261030-09`。

目前已透過使用者現有 Chrome 登入狀態唯讀檢查 DigitalPlat；尚未提交註冊、接受條款或建立 DNS，不能宣稱網域已取得。

2026-10-30 實際介面：可用免費名額 0、付費名額 0、方案名額 0。既有 `sqlnote.dpdns.org` 顯示「待刪除」；`tsplsimulator.dpdns.org` 顯示 2026-11-15 到期，其名稱伺服器為既有 Cloudflare 委派。未變更名稱伺服器或 DNS，也未取消刪除、續期、購買名額或切換帳號規避額度。

已詢問使用者選擇：採 `tsplsimulator.dpdns.org` 的分站子網域（例如 suite／mes／erp 等，保留原根域 DNS），或取得新名額後另註冊主網域。這是基於實際名額與既有網域狀態的配置選擇，並非再次要求使用者提供既有網域。DNS／HTTPS 的相依操作待選擇後進行；其他授權開發持續執行。

已查閱官方資料：

- [Privacy Policy](https://domain.digitalplat.org/privacy-policy/) 說明支援 Google Sign-In。
- [Acceptable Use Policy](https://domain.digitalplat.org/acceptable-use-policy/) 明列禁止藉多帳號取得更多免費註冊容量及規避限制。
- [Terms of Service](https://domain.digitalplat.org/terms-of-service/) 說明註冊／嘗試註冊會同意條款，免費容量以 slots 管理。

下一步先以一個合法帳號查明可用容量與註冊／DNS 介面，優先採一個主域加各分站子域，達成每站獨立網址而不迴避免費額度。候選主域可用性尚未查詢，不應當成已保留名稱。具體註冊表單、名稱、費用及條款確認完成後，才進行最終提交；登入驗證或 CAPTCHA 依實際介面處理。

需求包含主站、MES、ERP、POS、CRM、餐飲、電商及電商管理入口；各站 DNS、HTTPS 與對應路由仍待落地。這項工作已獲授權，不能再把「等待用戶提供既有網域」當成阻塞原因。

## 最新存取檢查

2026-10-30：選項尚未回覆，先以零新增費用的既有 `tsplsimulator.dpdns.org` 子網域方案進行唯讀存取檢查，沒有據此改動 DNS。既有 Cloudflare 登入只提供一個帳戶，網域總覽顯示沒有可用資料，無法管理該 zone；DigitalPlat 原網域頁另顯示安全驗證，未嘗試繞過或代為完成。

已將 Cloudflare 帳戶頁及 DigitalPlat 驗證頁保留供使用者交接，請使用者登入實際擁有 DNS 的帳戶（或指出其他管理服務）。這個步驟需要目前未提供的正確 DNS 帳戶存取，不是重新要求授權已同意的部署。公開入口程式已放到主機 release `20261030-17` 並通過 ARM64 驗證；現行服務仍為 release 16，沒有啟用 80／443 公開入口。
