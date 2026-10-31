# 完整分站交付驗收

2026-10-31：使用者要求各模組是完整站台，包含登入、各身分測試帳號、前後台資料差異、權限管理；POS／MES／ERP 支援標籤與表單列印。

## 必須完成

- 每站有專屬站名、站內導覽、作業前台、管理後台、帳號權限與登出，不以跨系統 tab 當站內導覽。
- 登入頁明列管理員、後台作業員、前台人員、唯讀人員測試帳號；測試空間按訪客隔離。
- 密碼雜湊、隨機工作階段、HttpOnly cookie；資料庫驗證身分與各站角色，不信任可修改的角色 cookie。
- 管理員可新增帳號、分站授權、停用授權；非管理員 API 拒絕；登出／撤權立即生效。
- 前台資料使用明確欄位與資料列範圍；直接呼叫後台 API 亦不能繞過。
- MES 保留 SAP 高密度工作台與工業資料功能；其他既有業務功能保留。
- POS：商品標籤、80mm 交易小票、班結報表；MES：物料／工單標籤、工單／報工單；ERP：品項標籤、採購／銷售／收貨單。使用真實目前組織資料，列印預覽與專用紙張 CSS。
- 身分偽造、跨組織、跨站授權、前後台差異、撤權、列印資料隔離皆須測試；正式建置與 Linux 公開瀏覽器驗收完成才可宣稱交付。

密碼與工作階段依據：[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)、[Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。

狀態：實作中，尚未公開部署。
