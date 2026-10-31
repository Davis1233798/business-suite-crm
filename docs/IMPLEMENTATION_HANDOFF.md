# 給指定實作模型的任務書

先完整讀 PLAN.md。只能在本專案目錄工作，不修改旁邊的ComfyUI。先確認模型實際ID與reasoning effort，記錄至執行報告；不可假稱使用另一個模型。

依P0→P4實作六套系統及Portfolio，各關完成後執行對應驗收並修復失敗。採Sites支援的Vinext/Workers/D1架構，開始前讀Sites技能與資料儲存/身分規範。不得把完整後端需求降成localStorage demo。先落實資料庫併發與交易，再製作畫面。若平台機制不支持正確庫存交易，提出可驗證替代方案並記錄，不能靠前端避免重複點擊。

每套系統都有專用角色、真實持久化資料、可操作主流程與報表。所有表格ID建立驗收映射。測試須檢查對業務有意義的不變量，不只檢查元素存在。金流、郵件與發票只用明確標示的模擬adapter，正式串接另列待辦。

至少交付：README.md、資料模型與migration、可重建seed、.env.example（無秘密）、API契約、原始碼、tests、驗收矩陣、測試報告、已知限制及部署方式。進度以NOT_STARTED/IN_PROGRESS/IMPLEMENTED/VERIFIED記錄，未跑測試不可VERIFIED。

若可部署，沿用Sites技能建立私人展示部署；完成後交付真實URL與測試證據。若環境或指定模型不可用，回報具體錯誤並保留可恢復進度，不任意更換模型、不假造成功。
