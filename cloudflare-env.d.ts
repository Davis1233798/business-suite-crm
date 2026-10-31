declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    INFRA_GATEWAY_URL?: string;
    INFRA_GATEWAY_TOKEN?: string;
    PLATFORM_CONTROL_URL?: string;
  }
}
