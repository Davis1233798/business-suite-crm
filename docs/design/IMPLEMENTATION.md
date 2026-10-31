# UI/UX 重構紀錄 · 2026-10-31

## 從範例到目前頁面的配對

上游提供設計分析與部分 illustrative 元件，不提供完整 MES／POS／CRM 應用程式。以下明確區分來源中的頁面模式與本專案的業務適配，不將自行實作稱為下載的官方頁面。

| 目前頁面 | 範例中實際採用的頁面／元件模式 | 本地實作 |
|---|---|---|
| 首頁 `/` | Vercel `template-card`、`card-marketing`、黑白 CTA、系統地圖 | 作品卡、領域篩選、案例範圍、工程介紹與資料工具 |
| `/platform` | Vercel app shell、分區卡與技術標籤 | 保留既有控制平台；納入共用導覽與響應式框架 |
| `/mes` | SAP application frame、product tabs、data-table cell | 保留最新 SAP 高密度工作台；共用生產表單改為可展開 |
| `/mes/industrial` | SAP 表格與摘要模式 | 保留設備／模型資料與既有介面；共用導覽與區域主題 |
| `/erp` | SAP product tabs、flat bands、白色單據表格與藍色操作 | 帳務摘要、帳卡與調撥、採銷與進階帳務區域導覽 |
| `/pos` | Shopify `/start`、`/pricing` 的 light transactional track（非原生 POS 範本） | 商品觸控卡、薄荷班別摘要、收款側欄與交易作業 |
| `/crm` | Airtable feature-card-tabbed、cream-callout、demo-grid 與結構化資料層級 | 摘要、六階段橫向看板、潛客與客服；業務看板由本專案適配 |
| `/dining` | Starbucks 產品詳情／選項、深綠 feature band、暖白產品卡 | 桌位、點餐、KDS、分帳與訂位；保留狀態色與催單文字 |
| `/shop` | Nike `/men` 列表與 `/t/...` 商品詳情模式、黑色 pill CTA | 商品列表、規格與庫存、購物袋與收件表單；圖片占位明確標註 |
| `/commerce` | Shopify light transactional track、card-pricing／mint chips（非原生訂單後台範本） | 訂單摘要、搜尋、付款狀態篩選、詳情定位與售後操作 |

原始資料：[Vercel](references/vercel/DESIGN.md)、[SAP](references/sap/DESIGN.md)、[Shopify](references/shopify/DESIGN.md)、[Airtable](references/airtable/DESIGN.md)、[Starbucks](references/starbucks/DESIGN.md)、[Nike](references/nike/DESIGN.md)。

## 共用重構

- SuiteFrame 管理路由主題，涵蓋全站導覽、跳到內容、展示聲明與頁尾。
- WorkspaceHeader／Links／Loading 統一頁首、區域入口、載入與錯誤重試。
- OperationForm 採原生 details 展開，減少同時顯示大量表單；開關不卸載欄位，保留草稿。
- 各站使用區域 token，避免全域色盤重寫；app/suite.css 集中提供共用與站台樣式，既有 MES／platform 模組保持獨立。
- 首頁、ERP、POS、CRM、餐飲與電商已重構版型；平台與 MES 以目前已完成的專用版型整合，不回退既有功能。

## 種子資料

已替換 CRM 公司／聯絡人、ERP 供應商／客戶、門市與配送地址、使用者顯示名稱等容易被誤認為真實資料的欄位。聯絡資訊採 example.test 與 DEMO-PHONE 代碼；資料表關聯與交易金額不變。

既有資料庫與舊備份不自動覆寫。新展示空間會使用新資料；已有空間若要重置，應先備份並由使用者透過原有重置流程操作，因重置會清除該空間的操作資料。

## 本地驗證

- 最新全專案 TypeScript 檢查通過（包含工作目錄中同步新增的 web/）；本輪未修改該遷移前端。
- 正式建置及 next/link namespace 驗證：通過。
- 含新增虛構種子身份／非撥號聯絡資料檢查，共 39 項行為測試全數通過。
- 真實瀏覽器：10 條頁面路徑、360／768／1440px；頁面沒有水平溢出。各尺寸截圖及 DOM 寬度記錄位於 outputs/ui-refactor/。
- 首頁篩選可縮至 MES／ERP 兩張卡；案例可展開，手機選單選取後收起。
- ERP 操作表單關閉／展開後保留草稿；唯讀角色送出新增商品表單回 403，畫面顯示拒絕原因，沒有建立資料；測試後已恢復管理員角色。
- POS 點擊商品更新購物籃、應收與找零；未執行實際提交收款。
- 電商加入規格後顯示 1 件／$100，手機購物袋入口可定位至收件表單；未提交新訂單。
- 後台搜尋無結果顯示空狀態；已付款篩選回一筆，待付款篩選顯示空狀態。
- 餐飲可切換 KDS 兩筆工作票與訂位表單；未送出新的訂位、出餐或結帳。
- 上述測試不代表已驗收正式外部金流、物流、設備或基礎設施服務。
- 本輪為本地改動，尚未部署到遠端環境。


## 第二輪視覺修正：React Bits 與作品集構圖

使用者指出前版過度白底、視覺不明顯後，已調整首頁為深色極光、大字排版、軌道玻璃圖形與六種彩色作品封面。作品卡實際使用 React Bits SpotlightCard；原始 TypeScript／CSS 與授權保存於 components/react-bits/，來源 commit 為 e12c22192ac7b4b452c5e2feb9b586d74765d696。來源授權為 MIT + Commons Clause，非單純 MIT；授權原文已隨附。

### 參考來源與採用範圍

- [React Bits](https://www.reactbits.dev/)：實際引入 SpotlightCard 原始碼，使用滑鼠／鍵盤焦點光暈與邊緣效果。
- [49 種 UI 風格文章](https://www.ccgxk.com/front-end/786.html)：選擇 Aurora、Glassmorphism、動效驅動作為設計方向；極光和軌道圖形為專案自行撰寫 CSS。
- [Land-book / Studio Sandcastle](https://land-book.com/websites/101802-studio-sandcastle-design-and-technology-studio)：已查看預覽，參考大型標題、案例入口及作品展示分區，不複製其圖像或文案。
- [Land-book / Twin](https://land-book.com/websites/101529-twin-ai-agents-that-run-your-business)：查看功能分區與動畫類別；作為商業產品敘事參考。
- [Land-book / Studio Iron](https://land-book.com/websites/101826-curated-objects-from-independent-designers-studio-iron-studio-iron)：查看電商分類作品頁，作為選品展示方向參考。
- [Awwwards](https://www.awwwards.com/)：已嘗試讀取首頁和 portfolio 類別，均逾時；尚未針對其中具體作品完成視覺核對，不宣稱本輪複製特定得獎作品。

### 變更與驗證

首頁有深色極光背景與輕微浮動動畫，六張作品卡有獨立色彩與真實互動光暈；ERP／POS／CRM／餐飲／電商前後台加入不同色調的品牌頁首；MES 與平台加入品牌場景但保留原有專用工作台。支援 reduced-motion，未新增動畫套件依賴。

TypeScript、正式建置與導航 ABI 驗證通過。真實瀏覽器 10 路徑 × 360／768／1440px 共 30 組檢查，無頁面級水平溢出；首頁篩選 6→2→6 張卡與案例展開通過，瀏覽器未出現 console error。本輪只調整視覺與卡片容器，不變更業務資料或 API，未重新執行前輪的 39 項領域測試。新畫面及寬度紀錄位於 outputs/ui-refactor/expressive-*。
