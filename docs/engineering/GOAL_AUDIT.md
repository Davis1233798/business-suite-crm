# 持續目標驗收稽核

日期：2026-10-30。目標仍維持原始範圍；不能用下列已完成子項推論全部交付完成。

2026-10-31（Asia/Taipei）部署追加驗收：八個公開網域 TLS 與首頁、HTTP 轉址、health、未授權控制與 dispatch 隔離全部通過；獨立憑證控制查詢 200，公開 MES／Platform 瀏覽器確認。此次「已設定完成，請重新架設」部署目標已完成；下表先前的網域阻塞已排除。其他原始範圍的限制仍照實保留。

| 原始要求 | 目前權威證據 | 尚待補齊或驗證 |
|---|---|---|
| 主站 IaC 管理分站 | `infra/sites.json`、Compose、主站獨立操作控制台；Linux 實測狀態／規劃／collector 重啟、單次計畫及漂移拒絕 | 六站 Web 已獨立容器；逐站 stop/start 驗證其他五站及主站保持可用且資料保留，見 `STATION_RUNTIMES.md`；主站入口與資料服務仍共用，未宣稱多節點 HA |
| 標準 TDD + loop engineering | `LOOP.md` 留存政策、控制、同步與瀏覽器 Red/Green；38 項應用、15 項 Python 測試、型別、建置與 ABI gate 通過 | GitHub Actions 定義已建立，未聲稱已於遠端 repository 實際執行 |
| 電商緩存與隊列緩解併發 | Redis 商品描述緩存；價格／庫存權威查詢；每頁單一規格查詢；付款原子 Outbox、RabbitMQ confirm／去重／死信；Linux 流程實測 | 已完成明確 P95<2s 門檻的有限併發驗證（32 並行讀取、16 筆庫存競爭、32 筆付款重送），見 `COMMERCE_CONCURRENCY.md`；尚無生產規模長時間容量上限證據，不宣稱 SQLite 支援任意流量 |
| MES 工業智慧與 AIoT | MQTT → TimescaleDB → Isolation Forest；模型版本／分數／訓練窗持久化；held-out 合成評估與 Linux 真實 MQTT 訓練／推論、延遲封包隔離通過，詳見 `AIOT_MODEL.md` | 尚未以真實工廠標註故障驗收；未接真實工廠設備 |
| 時序 DB + PostgreSQL 分表／分庫／分片 | TimescaleDB 時間 chunk；雙 PostgreSQL + 租戶 SHA256 路由 + 每庫四 Hash 分區；真實工單／報工／品檢事件與既有工單持續同步，亂序與 tombstone 實測 | PostgreSQL 目前是查詢模型，MES 交易仍在 D1／SQLite；未聲稱完成交易主庫換庫 |
| 遵循更新模板 | 新控制台使用 portfolio 黑白；MES 工作台依最新指示改為 SAP 高密度、工業頁沿用 SAP 藍色 token；三尺寸無頁面級橫溢出、錯誤狀態與導航實測 | 原有全部分站的新模板改版未在本輪完成，不能宣稱全站都已轉換 |
| Linux 部署 | `oci-jkes-1` 的 `20261030-18` 版本；17 容器、私有 Web／gateway；SHA 與真實流程收據見 `LINUX_DEPLOYMENT.md` | 用戶已指定 blockchen.duckdns.org，根域與七個子域 DNS、私有八站入口已驗證；公開 HTTP／HTTPS 仍逾時，既有 OCI 身分無網路管理權，待登入檢查入站規則。見 `DUCKDNS_DEPLOYMENT.md` |

後續維持原始範圍；分站獨立管理與可評估 AI 模型已有實測，有限併發證據已補齊，仍需各站網域／HTTPS 配置。用戶最新要求的 `/platform` 外觀已依 awesome-design-md / Vercel 範本重做，不代表上述後端與網域工作已完成。
