# Linux 分站交付包

解壓後，以專用非 root 使用者在交付目錄啟動：

```sh
mkdir -p /var/lib/business-suite
SUITE_WEB="$PWD/web-dist" SUITE_DB=/var/lib/business-suite/stations.sqlite SUITE_ADDR=127.0.0.1:8095 ./station-server
```

此二進位與 `web-dist` 必須來自同一個 GitHub Actions artifact；`COMMIT` 記錄來源版本。以受控代理提供 HTTPS，設定主站建置變數 `NEXT_PUBLIC_STATION_URL` 為實際分站 URL。既有資料庫必須先備份，不要用 CI artifact 覆寫資料。

此版本為分站登入／授權、查詢與列印預覽；業務交易寫入尚未從現有展示站移植。測試帳號與自動建立展示企業僅供示範，不能作為正式身分系統。
