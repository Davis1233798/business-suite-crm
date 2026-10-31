# 各站台設計模板與開發規劃

已完成原始文件下載、站台配對及本地 UI/UX 實作；詳見 [實作與驗證紀錄](IMPLEMENTATION.md)。來源是 awesome-design-md 的設計分析，不是可直接安裝的 React／HTML 主題。選型是依本專案業務需求作出的設計判斷，並不代表上游宣稱支援該業務系統。

## 模板配對

基礎設施中心 `/platform` 的實作與視覺規則見 [platform](sites/platform.md)，沿用主站 Vercel 範本。

| 站台 | 路徑 | 參考模板 | 開發範本 |
|---|---|---|---|
| 作品集首頁 | `/` | [vercel](references/vercel/DESIGN.md) | [portfolio](sites/portfolio.md) |
| ForgeFlow 製造管理 | `/mes` | [sap](references/sap/DESIGN.md) | [mes](sites/mes.md) |
| LedgerWorks 進銷存財 | `/erp` | [sap](references/sap/DESIGN.md) | [erp](sites/erp.md) |
| CounterPoint 門市收銀 | `/pos` | [shopify](references/shopify/DESIGN.md) | [pos](sites/pos.md) |
| RelationDesk 客戶商機 | `/crm` | [airtable](references/airtable/DESIGN.md) | [crm](sites/crm.md) |
| TableCraft 餐飲工作區 | `/dining` | [starbucks](references/starbucks/DESIGN.md) | [dining](sites/dining.md) |
| MarketLane 電商前台 | `/shop` | [nike](references/nike/DESIGN.md) | [shop](sites/shop.md) |
| MarketLane 電商營運後台 | `/commerce` | [shopify](references/shopify/DESIGN.md) | [commerce](sites/commerce.md) |

## 下載與來源

已保存 7 份原始 DESIGN.md、上游 LICENSE 及來源 commit／SHA-256 的 [manifest.json](manifest.json)。原始參考保持原樣；本專案適配規則放在 sites/，避免與來源混淆。上游 MIT 授權隨附；不包含品牌標誌、圖片或專有字體下載。

## 共用開發合約

1. 共用導覽、角色切換、資料重置及展示聲明保持一致；站台內容採各自視覺識別。
2. [tokens.json](tokens.json) 記錄已套用的 token；執行中的樣式由 app/suite.css 與既有 MES／platform CSS modules 提供。每站以 data-site 區域提供 --primary、--background、--card、--foreground 等；共用元件讀取最近區域的變數。
3. 成功、警告、危險色共用語意。主操作色與狀態色不混用；所有狀態搭配文字。中文字型使用 Segoe UI / Microsoft JhengHei / Arial。
4. 360／768／1440px 驗證；行動版單欄；表格只在自身容器捲動；操作區至少 44px；支援鍵盤及 reduced motion。
5. 必須覆蓋 loading、empty、error、pending、success、readonly。非必要不要重掛資料元件，以免清空正在編輯的表單。
6. app/shop/workspace.tsx 同時服務前台與後台：先分離展示元件或將 token 依 management 模式切換，維持相同業務與 API 邏輯。
7. components/domain-operations.tsx 跨模組共用：從所在區域繼承 token，不在共用層綁定單一品牌色。

## 實作順序與交付

| 階段 | 工作 | 可檢視交付 |
|---|---|---|
| 1 | 建立區域 token、共用 Button／Panel／Status／Table 規則 | 共用元件狀態展示與響應式截圖 |
| 2 | 首頁與 ERP，確認黑白作品集與企業工作台的差異 | 兩站三尺寸畫面與流程檢查 |
| 3 | MES、CRM，實作工單與看板資料密度 | 表格、看板、操作表單及唯讀狀態 |
| 4 | POS、餐飲，優先驗證觸控與收款／出餐 | 購物籃、收款、KDS 與分帳流程 |
| 5 | 電商前台與後台分離展示 | 商品到訂單、模擬付款到出貨／退款流程 |
| 6 | 全站回歸與對比驗收 | 型別檢查、相關既有測試、建置及各路徑截圖 |

每階段保留既有 API、資料結構及領域規則；模板未提供的互動由本專案範本定義，不假設下載文件附帶程式碼。現已以路由區域變數隔離站台風格；MES 依最新規範維持 SAP 工作台。
