# 基礎設施中心

路徑：`/platform`。依 [awesome-design-md / Vercel 原始參考](../references/vercel/DESIGN.md) 與 [作品集適配規則](portfolio.md) 實作，非 Vercel 官方介面。

本輪針對用戶指出的外觀問題重做頁面，保留既有控制 API、獨立操作憑證、規劃與執行流程。

- 白色畫布、黑色主操作、細分隔線、系統中文字體；技術標籤使用等寬字。
- 首屏採雙欄標題與邏輯架構示意；手機收合圖示，優先保留操作入口。
- 配置摘要、六個分站工作區、服務控制台、工程架構、開發循環依序呈現。
- 控制台使用深色操作流程與明亮表單分區；未連線時不顯示虛構健康狀態。
- 分站識別色只用於小型圖示；共用導覽只在此路徑切為黑白，保留其他站台樣式。
- 360／768／1440px 檢查頁面寬度、按鈕、字級、空間與表單錯誤。控制表格保留自己的水平捲動容器。
- 主操作與輸入至少 44px；次要文字至少 12px；支援鍵盤焦點與 reduced motion。

程式位置：`components/platform-overview.tsx`、`components/platform-control.tsx`、`components/platform-dashboard.module.css`。

驗證：TypeScript、正式建置與導航 ABI gate、控制權限單元測試及 Linux 實際控制流程；視覺證據由真實瀏覽器取得，不能以 API 通過代替畫面檢查。
