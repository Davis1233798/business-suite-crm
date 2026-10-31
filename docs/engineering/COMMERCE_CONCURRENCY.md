# 電商併發與緩存驗證

2026-10-30，Linux release `20261030-15`，既有 `oci-jkes-1` ARM64 單機、主機 loopback、同一個全新且獨立的展示租戶、沒有 TLS 或外部網路延遲。測試門檻在執行前設定為各階段 P95 < 2000ms、非預期 HTTP 回應為 0。這是有限工作負載的正確性與延遲驗證，不能當作最大容量、長時間穩態或正式 SLO。

## 實際收據

| 工作負載 | 請求數 / 並行數 | P50 | P95 | HTTP 結果 |
|---|---:|---:|---:|---|
| 已暖機商品 API | 256 / 32 | 210ms | 674ms | 256 筆 200 |
| 各自爭用全部剩餘庫存 | 16 / 16 | 115ms | 149ms | 1 筆 200、15 筆預期庫存拒絕 400 |
| 同一訂單成功付款重送 | 32 / 16 | 66ms | 154ms | 32 筆 200 |

- 實際資料庫檢查：在原有種子訂單之外，僅新增一張訂單；`shop.paid` 事件只有一筆。測試工具先讀取管理查詢的既有訂單基數，不能把種子訂單誤當競態造成的多單。
- 下單後重新讀取商品 API，該規格可用庫存為 0；Redis 僅含商品描述，沒有價格／庫存欄位。
- 不手動觸發派送，等待主站 timer → RabbitMQ → PostgreSQL，確認該訂單只有一個履約任務。
- 本地收據 `outputs/commerce-load-linux.json`；主機收據 `/srv/business-suite/shared/commerce-load-15.json` 與 `.log`。
- 重現：在已啟動完整 Linux stack 的發布根目錄執行 `sudo node scripts/load-commerce.mjs http://127.0.0.1:8090`。只允許 loopback／SSH tunnel；自建展示租戶，不重置其他資料。輸出位置可設 `LOAD_RECEIPT`。

## 本輪 TDD 改進

1. 冷緩存 50 請求測試先 Red，實際呼叫 loader 50 次；加入 pending fill 合併後只呼叫一次。協調範圍含 gateway URL、服務憑證、tenant、query digest；不同範圍不混用。完成或失敗皆移除 pending entry，最大 512 個；不建立另一層長期本地緩存。Redis 仍負責 30 秒 TTL 與跨程序快取；這個合併機制本身只在單一程序有效。
2. 健康檢查測試先 Red：無 cookie 的 `/api/health` 會發出示範 cookie 並建立租戶。修正 middleware，使匿名 probe 只檢查資料庫，不建立示範資料或 MES Outbox。五次 probe 的獨立資料庫測試維持 0 個租戶、無 Set-Cookie。既有資料未自動刪除。
3. 37 項應用、15 項 Python、TypeScript、正式建置與導航 ABI gate 全部通過。Linux Redis／MQTT／分片與投影服務 smoke 同時通過。

後續容量規劃仍須指定目標 RPS、持續時間、資料量、租戶分佈及外部網路條件，再做長時間壓測；目前未宣稱 SQLite 交易庫具備多節點高可用或無限吞吐量。

## 成功／失敗通知競態（release 20261030-16）

新增 20 個交錯 success／failed callback 的整合測試先 Red：最終訂單被降為 failed，但付款事件已存在。修正 SQL 交易內的狀態轉移，paid 不會被稍後的 failed 覆寫；回應重新讀取實際已提交狀態，庫存預留維持 consumed。

Linux 再以 `--mixed-payments` 執行 32 個交錯通知、16 並行，全部回 200，P95 175ms；資料庫確認最終 paid、無未消耗預留、只有一個付款事件；自動派送後 PostgreSQL 仍只有一個履約任務。同輪 256 次商品查詢 P95 1247ms、庫存爭用 P95 182ms，均符合既定 2000ms 門檻。收據：`outputs/commerce-mixed-linux.json`、主機 `/srv/business-suite/shared/commerce-mixed-16.json`。兩輪延遲是各自工作負載的觀測值，不用來宣稱版本間效能改善。
