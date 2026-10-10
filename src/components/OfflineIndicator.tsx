import { useEffect, useState } from "react";
import { useLang } from "@/lib/i18n";
import { subscribeSync, syncNow } from "@/lib/offline-store";

export function OfflineIndicator() {
  const { t } = useLang();
  const [online, setOnline] = useState(true);
  const [sync, setSync] = useState({ pending: 0, syncing: false });

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => { setOnline(true); void syncNow(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const unsub = subscribeSync(setSync);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      unsub();
    };
  }, []);

  if (online && !sync.syncing && sync.pending === 0) return null;

  let label: string = t("offline_status");
  if (online && sync.syncing) label = `Syncing ${sync.pending} change(s)…`;
  else if (online && sync.pending) label = `${sync.pending} change(s) waiting to sync`;
  else if (!online && sync.pending) label = `${t("offline_status")} · ${sync.pending} change(s) saved`;

  return (
    <div className="lp-offline-pill" role="status" aria-live="polite">
      <span className="lp-offline-dot" aria-hidden="true">
        <i className={online ? "fa-solid fa-rotate" : "fa-solid fa-wifi-slash"} />
      </span>
      <span>{label}</span>
    </div>
  );
}
