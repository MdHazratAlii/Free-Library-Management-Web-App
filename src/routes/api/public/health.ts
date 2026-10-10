import { createFileRoute } from "@tanstack/react-router";
import { handleHealthCheck } from "@/lib/health-check";

// Uses only the public Supabase URL + publishable/anon key from your environment.
// Server runtime vars win; the VITE_ values are baked in at build time as a fallback
// (Cloudflare Workers does not always expose process.env).
export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      ANY: ({ request }) =>
        handleHealthCheck(request, {
          url:
            (typeof process !== "undefined" ? process.env["SUPABASE_URL"] : undefined) ||
            import.meta.env["VITE_SUPABASE_URL"],
          publishableKey:
            (typeof process !== "undefined" ? process.env["SUPABASE_PUBLISHABLE_KEY"] : undefined) ||
            import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"],
        }),
    },
  },
});
