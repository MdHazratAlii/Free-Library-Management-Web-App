import { z } from "zod";

const resultSchema = z.object({
  allowed: z.boolean(),
  retry_after: z.number().int().min(0).max(3600),
}).strict();

const securityHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

function reply(status: number, message: string, headers: Record<string, string> = {}) {
  return Response.json(
    { status: status === 200 ? "ok" : "error", message },
    { status, headers: { ...securityHeaders, ...headers } },
  );
}

export type HealthConfig = { url: string | undefined; publishableKey: string | undefined };

export async function handleHealthCheck(
  request: Request,
  config: HealthConfig,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "GET") {
    return reply(405, "Method not allowed", { Allow: "GET" });
  }
  const url = new URL(request.url);
  if (url.search || request.body !== null || request.headers.has("transfer-encoding") ||
      (request.headers.has("content-length") && request.headers.get("content-length") !== "0")) {
    return reply(400, "Invalid request");
  }
  let headerBytes = 0;
  request.headers.forEach((value, key) => { headerBytes += key.length + value.length; });
  if (headerBytes > 8192 || url.pathname.length > 128) {
    return reply(431, "Request too large");
  }
  if (!config.url || !config.publishableKey || config.publishableKey.startsWith("sb_secret_")) {
    return reply(503, "Health check unavailable");
  }
  try {
    // Public key only. This function owns only the isolated limiter row and
    // has no privileges on books, students, roles, or other application data.
    const response = await fetcher(`${config.url.replace(/\/+$/, "")}/rest/v1/rpc/check_keep_alive`, {
      method: "POST",
      headers: {
        apikey: config.publishableKey,
        "Content-Type": "application/json",
        ...(config.publishableKey.startsWith("sb_") ? {} : { Authorization: `Bearer ${config.publishableKey}` }),
      },
      body: "{}",
      signal: AbortSignal.timeout(4000),
      redirect: "manual",
    });
    if (!response.ok) return reply(503, "Health check unavailable");
    const result = resultSchema.safeParse(await response.json());
    if (!result.success) return reply(503, "Health check unavailable");
    if (!result.data.allowed) {
      return reply(429, "Too many requests", { "Retry-After": String(Math.max(1, result.data.retry_after)) });
    }
    return reply(200, "Supabase is alive");
  } catch {
    // Never expose upstream errors, URLs, keys, or database details.
    return reply(503, "Health check unavailable");
  }
}