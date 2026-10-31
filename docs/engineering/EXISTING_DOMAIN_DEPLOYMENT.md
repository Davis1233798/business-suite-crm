# 既有網域部署進度

2026-10-30（Asia/Taipei）。

主機 `oci-jkes-1` 的 `/srv/business-suite/current` 現指向 `20261030-11`，17 個既有容器運作，Web `/api/health` 回報資料庫已連線。對外 IPv4 為 `150.230.2.37`。

已將 `infra/linux/Caddyfile.subdomains` 與 `compose.subdomains.yaml` 上傳同版主機，Compose 及 Caddy validate 通過。尚未啟動 edge；等待 DNS 管理帳號登入與記錄設定，避免對尚未解析的名稱反覆申請憑證。

規劃的 A 記錄（各自指向 `150.230.2.37`）：

| 子網域（位於 tsplsimulator.dpdns.org） | 入口 |
|---|---|
| portfolio | / |
| platform | /platform |
| mes | /mes |
| erp | /erp |
| pos | /pos |
| crm | /crm |
| dining | /dining |
| shop | /shop |
| commerce | /commerce |

不更動根網域與既有記錄。各站透過既有 Web proxy 分派；站台內連結仍保留原路徑。內部 dispatch API 在 edge 封鎖。資料庫、gateway 與控制容器不增加公開 port。

DigitalPlat 畫面顯示 sqlnote.dpdns.org 為 pendingdelete、DNS 停用；tsplsimulator.dpdns.org 正常，2026-11-15 到期，需及時續期。兩者原 NS 為 Cloudflare。瀏覽器 Cloudflare 頁面要求登入，目前尚未設定 DNS，也尚未取得正式 HTTPS 憑證，不可宣稱公開部署完成。

DNS 設定與解析確認後，於主機 infra 目錄執行：

```bash
sudo docker compose --project-name business-suite --env-file .env -f compose.yaml -f linux/compose.web.yaml -f linux/compose.subdomains.yaml up -d --no-deps edge
```

再確認 OCI 網路規則與主機防火牆允許 TCP 80/443，驗證所有正式 HTTPS 入口及 dispatch 404。不能只以容器 running 判定對外可用。
