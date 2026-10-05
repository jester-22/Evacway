import { useEffect, useState } from "react";

export default function NetworkStatus() {
  const [offline, setOffline] = useState(!navigator.onLine);
  const [restored, setRestored] = useState(false);

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
    return () => {
      window.clearTimeout(restoreTimer);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!offline && !restored) return null;

  return (
    <div className={`network-status ${offline ? "is-offline" : "is-online"}`} role="status">
      {offline ? "Offline. Live reports and requests are unavailable." : "Connection restored."}
    </div>
  );
}