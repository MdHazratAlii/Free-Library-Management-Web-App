import { describe, expect, it, vi } from "vitest";
import { handleHealthCheck } from "../lib/health-check";

const config = { url: "https://database.example", publishableKey: "sb_publishable_test" };
const request = () => new Request("https://library.example/api/public/health");

describe("public health check", () => {
  it("returns the exact healthy response without credentials or caching", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ allowed: true, retry_after: 0 }));
    const response = await handleHealthCheck(request(), config, fetcher);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", message: "Supabase is alive" });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const call = fetcher.mock.calls[0];
    expect(call?.[0]).toBe("https://database.example/rest/v1/rpc/check_keep_alive");
    expect(new Headers(call?.[1]?.headers).has("Authorization")).toBe(false);
  });

  it("respects the durable limiter and emits Retry-After", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ allowed: false, retry_after: 3600 }));
    const response = await handleHealthCheck(request(), config, fetcher);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("3600");
  });

  it("rejects methods, parameters and oversized headers before database access", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const [input, expected] of [
      [new Request(request(), { method: "POST", body: "bad" }), 405],
      [new Request("https://library.example/api/public/health?key=bad"), 400],
      [new Request(request(), { headers: { "x-large": "x".repeat(8193) } }), 431],
    ] as const) {
      expect((await handleHealthCheck(input, config, fetcher)).status).toBe(expected);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("hides upstream errors and fails closed", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("private database detail"));
    const response = await handleHealthCheck(request(), config, fetcher);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private database detail");
    expect((await handleHealthCheck(request(), { ...config, publishableKey: "sb_secret_invalid" }, fetcher)).status).toBe(503);
  });
});