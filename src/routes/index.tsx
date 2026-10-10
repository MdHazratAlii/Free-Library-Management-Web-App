import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AuthPage } from "@/components/AuthPage";
import { rememberLibrarian, setOfflineUser, wasLibrarian } from "@/lib/offline-store";

// Offline reload: read the saved sign-in directly so Supabase never waits on a token refresh.
function storedUserId(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (!/^sb-.*-auth-token$/.test(k)) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? "null");
      const id = v?.user?.id ?? v?.currentSession?.user?.id;
      if (typeof id === "string") return id;
    }
  } catch { /* ignore */ }
  return null;
}

const Dashboard = lazy(() =>
  import("@/components/LibraryDashboard").then((module) => ({ default: module.Dashboard })),
);

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Library Pro — Library Management System" }, { name: "description", content: "Manage your library books, students, loans, returns, and fines in Library Pro." }, { property: "og:title", content: "Library Pro — Library Management System" }, { property: "og:description", content: "Manage your library books, students, loans, returns, and fines in Library Pro." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: Index,
});

type Status = "loading" | "auth" | "admin";

function Index() {
  const [status, setStatus] = useState<Status>("loading");
  const [denied, setDenied] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [displayed, setDisplayed] = useState<Status>("loading");
  const [transitioning, setTransitioning] = useState(false);
  const prevRef = useRef<Status>("loading");

  useEffect(() => {
    const t = setTimeout(() => setSplashDone(true), 1100);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (prevRef.current === status) {
      setDisplayed(status);
      return;
    }
    setTransitioning(true);
    const t = setTimeout(() => {
      setDisplayed(status);
      prevRef.current = status;
      requestAnimationFrame(() => setTransitioning(false));
    }, 220);
    return () => clearTimeout(t);
  }, [status]);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!navigator.onLine) {
        const id = storedUserId();
        if (id && (await wasLibrarian(id))) { setOfflineUser(id); if (alive) setStatus("admin"); return; }
      }
      // Use local session first — works offline (reads from localStorage).
      const { data: sess } = await Promise.race([
        supabase.auth.getSession(),
        new Promise<{ data: { session: null } }>((r) => setTimeout(() => r({ data: { session: null } }), 5000)),
      ]);
      if (!alive) return;
      const user = sess.session?.user ?? (storedUserId() ? { id: storedUserId()! } : null);
      if (!user) { setStatus("auth"); return; }
      setOfflineUser(user.id);
      try {
        const { data: roleRow, error } = await supabase
          .from("user_roles").select("role")
          .eq("user_id", user.id).eq("role", "admin").maybeSingle();
        if (!alive) return;
        if (error) throw error;
        if (roleRow) {
          void rememberLibrarian(user.id);
          setDenied(false); setStatus("admin");
        } else {
          await supabase.auth.signOut();
          setDenied(true);
          setStatus("auth");
        }
      } catch (e) {
        // Offline: let a previously confirmed librarian open the cached data.
        const msg = String((e as { message?: string })?.message ?? e);
        const netDown = !navigator.onLine || /fetch|network|load failed/i.test(msg);
        if (netDown && (await wasLibrarian(user.id))) { if (alive) setStatus("admin"); return; }
        setStatus("auth");
      }
    };
    check();
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        setTimeout(() => { if (alive) void check(); }, 0);
      }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);

  return (
    <>
      {!splashDone && <Splash />}
      <div
        key={displayed}
        className="lp-view-swap"
        data-leaving={transitioning ? "true" : "false"}
        style={{ animation: "lpAppIn .5s ease-out both" }}
      >
        {displayed === "admin" ? (
          <Suspense fallback={<Splash />}>
            <Dashboard />
          </Suspense>
        ) : (
          <AuthPage denied={denied} />
        )}
      </div>
    </>
  );
}

function Splash() {
  return (
    <div className="lp-splash" role="status" aria-label="Loading Library Pro">
      <div className="lp-splash-inner">
        <div className="lp-splash-logo">
          <i className="fa-solid fa-book" />
        </div>
        <div className="lp-splash-title">Library Pro</div>
        <div className="lp-splash-bar"><span /></div>
      </div>
    </div>
  );
}
