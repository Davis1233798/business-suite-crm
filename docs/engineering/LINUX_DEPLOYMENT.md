# Linux 部署驗證

日期：2026-10-30，Asia/Taipei。

- SSH 目標：`oci-jkes-1`；ARM64 Ubuntu 24.04。
- 目前版本：`/srv/business-suite/releases/20261030-18`。
- 操作入口：`/srv/business-suite/current`，指向上述已驗證版本。
- 發布包 SHA-256：`31973729d1ac7dba43fcaa94188a922f145d22724cddd001f36ea129605b52fb`。
- 17 個容器：主站 Web、六個分站 Web、獨立 control agent、gateway、Redis、RabbitMQ、履約 consumer、MQTT broker、collector、TimescaleDB、兩個 PostgreSQL shard。
- Web 綁定主機 `127.0.0.1:8090`；gateway 綁定 `127.0.0.1:8088`。資料庫與 MQTT 未開主機公開連接埠。
- 正式主機獨立產生服務密碼，保存在 `/srv/business-suite/shared/infra.env`；沒有複製本機測試憑證。

公開入口最新狀態（2026-10-31 Asia/Taipei）：`blockchen.duckdns.org` 與七個子域均已通過外部 HTTPS 驗證；HTTP 308、首頁最終 200、health 200、dispatch 404、無憑證控制 401，獨立憑證控制查詢 200。17 個業務／資料服務加 Caddy 共 18 容器運行。見 `DUCKDNS_DEPLOYMENT.md` 與 `outputs/public-https-verification.json`。

## 已實測

- 38 項應用測試、15 項 Python 政策／控制／模型測試、TypeScript、正式建置通過。
- 本機及 Linux 服務測試：Redis 租戶隔離、雙資料庫與 Hash 分區、消息重送去重、MQTT 寫入時序庫與租戶隔離通過。
- Linux Web：六站 API、POS 金額、重送、唯讀拒絕、租戶隔離、MES／ERP／CRM／餐飲／電商核心流程通過。
- 真實 Web 付款 → 原子 Outbox → RabbitMQ → PostgreSQL 履約任務通過。
- 不手動呼叫派送 API，等待 Node 每分鐘 timer，也能完成上述履約任務。
- 主站操作 API 已實測：展示 cookie 與 gateway token 不能取得控制權；使用獨立操作憑證可查詢狀態、規劃及重啟 collector，重播與容器狀態漂移會被拒絕。重啟後 MQTT 寫入再次通過。
- MES 已實測：實際開工／報工 → 交易內事件 → 每分鐘自動同步 → PostgreSQL 分片查詢，租戶隔離與資料重置後的版本圍籬均通過；服務測試另驗證兩庫的舊版本／刪除標記保護。
- 新增主站 IaC 頁使用 portfolio 黑白 token；設備頁使用 MES Linear 明亮 token。新增頁以 360／768／1440px 進行響應式檢查；不代表原有全部分站已完成新模板改版。
- 瀏覽器發現並修正 Vinext 動態導航 namespace 被併入入口後遺失介面的建置問題；維持 `next/link`，透過 client chunk 隔離與入口簽章／匯出設定修復。加入 `postbuild` 與 Linux 封裝 ABI gate；遠端實際點擊主站 → MES、MES → ERP 成功，MES 更新後顯示一筆 PostgreSQL 工單摘要。控制台亦驗證無效憑證的錯誤狀態。
- 依用戶最新外觀回饋，重做 `/platform` 為 awesome-design-md / Vercel 風格：黑白頁框、配置摘要、分站卡、架構圖、黑白操作控制台與循環步驟。360／768／1440px 無頁面級橫向溢出；loading 與錯誤提示實測，並重新驗證 Linux 控制 API 與既有業務流程。

- 六站分別實際 stop/start 通過：各站停止時回 503，主站及其他五站 API 仍為 200；重啟後資料 ID 保留。收據 `/srv/business-suite/shared/station-isolation-11.log`，細節見 `STATION_RUNTIMES.md`。

- MES 依用戶要求改為 SAP 風格高密度工作台；桌面首屏八類資訊、搜尋／狀態篩選／選取、唯讀 403 及三尺寸溢出檢查通過。型別、建置、ABI gate 與六站 Linux 交易流程再次通過。詳見 `docs/design/sites/mes.md`。

- 電商有限併發驗證通過：256 商品讀取／32 並行 P95 674ms；16 筆爭用全庫存只成功一筆；32 筆付款重送只產生一個付款事件及自動派送的履約任務。冷緩存同程序合併、匿名 probe 不建立租戶已完成 TDD。見 `COMMERCE_CONCURRENCY.md` 與主機 `commerce-load-15.json`。

- 付款成功／失敗競態修正已部署：Linux 32 個交錯通知，最終 paid、預留 consumed、單一事件／履約任務；六站停啟重驗，電商後台也隨 shop 停止。收據 `commerce-mixed-16.json`、`station-isolation-16.log`。八站公開 HTTPS overlay 現已部署並通過私有路由實測，尚未完成外部連線及 TLS 驗收，見 `DUCKDNS_DEPLOYMENT.md`。

## 私有預覽

```powershell
ssh -N -L 127.0.0.1:8791:127.0.0.1:8090 oci-jkes-1
```

開啟 `http://127.0.0.1:8791/platform` 或 `/mes/industrial`。SSH 隧道僅在該用戶端存活期間可用。

## 操作

```bash
cd /srv/business-suite/current
sudo node scripts/infra.mjs status --linux
node scripts/infra.mjs plan mes --linux
sudo node scripts/infra.mjs logs shop --linux
```

分站 Web 容器可獨立啟停；主站入口與資料卷共用，停止主站 web 會影響所有站台入口。volume 保留業務資料、RabbitMQ、MQTT、時序與 PostgreSQL 資料；更新不刪除 volume。

## 尚未完成或未宣稱

- DNS 已就緒；待 OCI 入站 80／443 可達後重新啟動 edge 並完成公開 TLS 驗收。現階段仍使用 SSH 私有預覽。
- 原有交易資料在 Linux 使用 SQLite 的 D1 相容介面；MES 既有工單已回填並持續同步至 PostgreSQL 分片查詢模型，交易主庫仍保留。既有雲端 D1 資料未自動搬到 Linux。
- 工業智慧已加入 Isolation Forest 異常模型、事件判定追溯與合成資料評估（見 `AIOT_MODEL.md`）；尚未完成真實工廠設備及標註故障驗收。
- 已做有限單機併發驗證，尚未進行生產規模長時間壓測、多節點 HA、正式設備 TLS／個別 ACL 及災難復原演練。
