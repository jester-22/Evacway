import { useEffect, useState } from "react";
import { formatManilaDateTime } from "../../utils/dateTime";

const SAVED_DATA_TIME_KEY = "evacway_saved_public_data_at";

function formatSavedTime(value) {
  return formatManilaDateTime(
    value,
    { dateStyle: "medium", timeStyle: "short" },
    "the last time you were online"
  );
}

export default function NetworkStatus() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState(() => localStorage.getItem(SAVED_DATA_TIME_KEY));

  useEffect(() => {
    let restoreTimer;

    function handleOffline() {
      window.clearTimeout(restoreTimer);
      setRestored(false);
      setOffline(true);
    }

    function handleOnline() {
      setOffline(false);
      setRestored(true);
      window.clearTimeout(restoreTimer);
      restoreTimer = window.setTimeout(() => setRestored(false), 3500);
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    const handleServiceWorkerMessage = (event) => {
      if (event.data?.type !== "evacway-saved-data" || !event.data.savedAt) return;
      localStorage.setItem(SAVED_DATA_TIME_KEY, event.data.savedAt);
      setSavedAt(event.data.savedAt);
    };
    navigator.serviceWorker?.addEventListener("message", handleServiceWorkerMessage);
    return () => {
      window.clearTimeout(restoreTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      navigator.serviceWorker?.removeEventListener("message", handleServiceWorkerMessage);
    };
  }, []);

  if (!offline && !restored) return null;

  return (
    <div className={`network-status ${offline ? "is-offline" : "is-online"}`} role="status">
      {offline
        ? `You're offline. Showing saved data from ${formatSavedTime(savedAt)}`
        : "Connection restored."}
    </div>
  );
}
