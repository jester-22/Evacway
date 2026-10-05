import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBell,
  faBellSlash,
  faCheck,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { api } from "../services/api";
import "../components_css/NotificationCenter.css";

function decodeVapidKey(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export default function NotificationCenter({ onSelect }) {
  const bellRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [pushMessage, setPushMessage] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [panelPosition, setPanelPosition] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const result = await api.getNotifications();
        if (mounted) {
          setNotifications(result.notifications || []);
          setUnreadCount(result.unread_count || 0);
        }
      } catch {
        // Keep the last successful list visible if the network drops.
      }
    }

    refresh();
    const interval = window.setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (currentSubscription) => {
        if (currentSubscription) {
          await api.savePushSubscription(currentSubscription.toJSON());
          setSubscription(currentSubscription);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    function positionPanel() {
      const rect = bellRef.current?.getBoundingClientRect();
      if (!rect) return;

      const panelWidth = Math.min(390, window.innerWidth - 24);
      const panelHeight = Math.min(window.innerHeight * 0.7, 600);
      const mobile = window.innerWidth <= 720;
      const left = mobile
        ? Math.min(Math.max(12, rect.right - panelWidth), window.innerWidth - panelWidth - 12)
        : Math.min(Math.max(12, rect.left), window.innerWidth - panelWidth - 12);
      const top = mobile
        ? Math.max(12, rect.top - panelHeight - 10)
        : Math.min(rect.bottom + 10, window.innerHeight - panelHeight - 12);

      setPanelPosition({ left, top, width: panelWidth });
    }

    positionPanel();
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    return () => {
      window.removeEventListener("resize", positionPanel);
      window.removeEventListener("scroll", positionPanel, true);
    };
  }, [open]);

  async function handleSelect(notification) {
    try {
      await api.markNotificationRead(notification.id);
    } catch {
      // Navigation should still work if marking read fails temporarily.
    }
    setNotifications((current) => current.map((item) => (
      item.id === notification.id ? { ...item, is_read: true } : item
    )));
    setUnreadCount((count) => Math.max(0, count - (notification.is_read ? 0 : 1)));
    setOpen(false);
    onSelect(notification);
  }

  async function handlePushToggle() {
    setPushBusy(true);
    setPushMessage("");
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        throw new Error("Push notifications are not supported by this browser.");
      }

      const registration = await navigator.serviceWorker.ready;
      if (subscription) {
        await api.removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
        setSubscription(null);
        setPushMessage("Push notifications disabled on this device.");
      } else {
        const config = await api.getVapidPublicKey();
        if (!config.enabled || !config.public_key) {
          throw new Error("Web Push is not configured on the server yet.");
        }
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          throw new Error("Allow notifications in your browser settings to enable push.");
        }
        const created = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(config.public_key),
        });
        await api.savePushSubscription(created.toJSON());
        setSubscription(created);
        setPushMessage("Push notifications enabled on this device.");
      }
    } catch (error) {
      setPushMessage(error.message || "Could not update push notification settings.");
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <>
      <div className="notification-center">
      <button
        ref={bellRef}
        type="button"
        className="notification-bell"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FontAwesomeIcon icon={faBell} />
        {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span>}
      </button>
      </div>

      {open && panelPosition && createPortal(
        <section className="notification-panel" style={panelPosition} aria-label="Notifications">
          <header className="notification-panel-head">
            <h2>Notifications</h2>
            <span>{unreadCount} unread</span>
          </header>

          <div className="notification-list">
            {notifications.length === 0 ? (
              <p className="notification-empty">No notifications yet.</p>
            ) : notifications.map((notification) => (
              <button
                type="button"
                key={notification.id}
                className={`notification-item ${notification.is_read ? "is-read" : "is-unread"} ${notification.is_emergency ? "is-emergency" : ""}`}
                onClick={() => handleSelect(notification)}
              >
                <span className="notification-item-icon">
                  <FontAwesomeIcon icon={notification.is_emergency ? faTriangleExclamation : faCheck} />
                </span>
                <span className="notification-item-copy">
                  <strong>{notification.title}</strong>
                  <span>{notification.message}</span>
                  <small>{notification.created_at ? new Date(notification.created_at).toLocaleString() : ""}</small>
                </span>
                {!notification.is_read && <span className="notification-unread-dot" aria-label="Unread" />}
              </button>
            ))}
          </div>

          <footer className="notification-panel-footer">
            <button type="button" onClick={handlePushToggle} disabled={pushBusy}>
              <FontAwesomeIcon icon={subscription ? faBellSlash : faBell} />
              {pushBusy ? "Updating…" : subscription ? "Disable push" : "Enable push"}
            </button>
            {pushMessage && <span role="status">{pushMessage}</span>}
          </footer>
        </section>,
        document.body
      )}
    </>
  );
}