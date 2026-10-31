# Business Suite UI/UX

> 2026-10-31 最新視覺方向：首頁已改為深色極光、浮動軌道構圖、彩色作品卡及 React Bits SpotlightCard。app/expressive.css 在既有套件樣式之後載入，優先於下列舊黑白首頁規範；業務工作台加入各自的品牌色頁首，資料操作表面保持可讀。

目前實作以 [站台設計規劃](docs/design/README.md) 與 [實作紀錄](docs/design/IMPLEMENTATION.md) 為準。原始品牌設計分析保持原樣，另附 MIT 授權及來源版本；頁面是專案適配，並非品牌官方模板。

## 區域與版型

- 首頁、基礎設施中心：Vercel 黑白框架、案例卡與工程資訊層級。
- MES（含設備頁）、ERP：SAP 工作台，白色表格與藍色操作。MES 保留既有高密度版型。
- POS、電商後台：Shopify 明亮交易表面；POS 商品與收款並排，後台以訂單表及付款篩選為核心。
- CRM：Airtable 中性表面、摘要分區及六階段橫向商機看板。
- 餐飲：Starbucks 暖白與深綠；KDS 採白底與狀態標籤。
- 電商前台：Nike 商品列表與購物袋結構；無商品照片時明確標示占位。

## 實作合約

- SuiteFrame 依路由設定 data-suite-theme，站台主色／底色／邊框由 app/suite.css 繼承，不改寫全域 Tailwind 色盤。
- 共用 WorkspaceHeader、WorkspaceLinks、WorkspaceLoading；操作表單採原生 details 漸進展開，保留已填草稿。
- 不在畫面顯示測試編號作為產品標題。金額、狀態、未付款及模擬服務需有清楚文字。
- 按鈕有鍵盤焦點；行動版操作至少 44px。表格／商機看板在自己的容器捲動。
- 正式流程、角色權限、API 與資料模型延用既有程式；不得用靜態假數據取代現有查詢。
- 種子身份使用明確虛構名稱、example.test 信箱與 DEMO-PHONE 代碼。原有空間／備份不自動覆寫。

規格 token 見 [tokens.json](docs/design/tokens.json)，執行中 CSS 為實際樣式來源。
