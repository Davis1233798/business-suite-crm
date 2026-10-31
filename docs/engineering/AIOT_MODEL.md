# MQTT 設備異常模型

2026-10-30：`runtime/intelligence.py` 使用 scikit-learn 1.7.2 Isolation Forest（64 trees、contamination 0.02、random_state 42、單執行緒）。每台設備獨立取嚴格早於待評事件時間的最近 256 筆量測。至少 64 筆且數值有變化才訓練；不足時明確標記暖機／變化不足並沿用既有統計規則。這是單一量測值的無監督異常偵測，尚非經工廠驗收的預測維護模型。

每筆事件保存演算法、library 版本、訓練資料摘要 SHA256、筆數、時間窗、分數、門檻、模型就緒狀態與判定方法。分數越大越異常；高於學得門檻才標記。當前點不參與自身訓練，延遲封包也不能讀取其未來的歷史。查詢同時限制 tenant 與 device。MQTT 去重與量測／判定寫入仍在同一筆 PostgreSQL 交易中，成功 commit 才 ack。

既有 Timescale volume 由 collector 啟動時在 advisory lock 下進行可重入的 additive migration；不刪除舊紀錄，舊紀錄顯示「既有統計紀錄」。模型由有界訓練窗重建，LRU 最多 64 組訓練窗；不載入外部 pickle。每筆訓練成本受 256 筆、64 trees 上限約束，尚未宣稱吞吐 SLO。

## TDD 與驗證

- Red：新增 `test_intelligence.py`，缺少模型模組而失敗。
- Green：暖機、常數訊號、可重現性、當前點不進訓練與 held-out 合成資料測試通過。
- 固定 seed 42：256 筆 N(20,1) 訓練；獨立 100 筆正常與 20 筆 N(30,1) 故障評估。結果 TP=20、FN=0、FP=2、TN=98。這只是合成分佈的回歸門檻，不能外推工廠準確率。
- `npm run engineering:check`：14 項 Python、33 項應用測試、TypeScript、正式建置與導航 ABI gate 通過。
- Linux release `20261030-10`：真實 MQTT 發送 64 筆正常基線及 1 筆故障；gateway 查詢確認 ready、samples=64、64 字元模型識別碼、score>threshold、anomaly=true。再發更早的封包，確認 samples=0。租戶隔離通過。收據在 `/srv/business-suite/shared/deploy-10.log`。
- 瀏覽器 `/mes/industrial`：模型欄位、暖機說明與真實工單查詢正常；無量測的租戶維持空白狀態，不補假資料。

官方方法與分數定義：[scikit-learn IsolationForest](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.IsolationForest.html)。後續仍需各機台量測單位／工況、標註故障、漂移與誤報驗收，才可調整生產門檻。
