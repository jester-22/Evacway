import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBell,
  faBellSlash,
  faCheck,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../services/api";
import { queryKeys, useNotifications } from "../../hooks/useEvacuationQueries";
import "./NotificationCenter.css";

function decodeVapidKey(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export default function NotificationCenter({ onSelect }) {
  const bellRef = useRef(null);
  const queryClient = useQueryClient();
  const notificationsQuery = useNotifications();
  const refetchNotifications = notificationsQuery.refetch;
  const notifications = notificationsQuery.data?.notifications || [];
  const unreadCount = notificationsQuery.data?.unread_count || 0;
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [pushMessage, setPushMessage] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [panelPosition, setPanelPosition] = useState(null);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refetchNotifications();
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [refetchNotifications]);

  // Auto-enable push notifications on page load / login
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushMessage("Push notifications are not supported by this browser.");
      return;
    }

    let cancelled = false;

    async function autoEnablePush() {
      setPushBusy(true);
      setPushMessage("");

      try {
        // Reuse existing subscription if one is already registered
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          await api.savePushSubscription(existing.toJSON());
          setSubscription(existing);
          setPushMessage("Push notifications are already enabled on this device.");
          return;
        }

        // Fetch VAPID public key
        const config = await api.getVapidPublicKey();
        if (!config.enabled || !config.public_key) {
          setPushMessage("Web Push is not configured on the server yet.");
          return;
        }

        // Request notification permission
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setPushMessage("Notification permission was not granted. You can enable it in your browser settings.");
          return;
        }

        // Subscribe to push
        const created = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(config.public_key),
        });
        await api.savePushSubscription(created.toJSON());
        setSubscription(created);
        setPushMessage("Push notifications are now enabled on this device.");
      } catch (error) {
        if (!cancelled) {
          setPushMessage(error.message || "Could not enable push notifications.");
        }
      } finally {
        if (!cancelled) setPushBusy(false);
      }
    }

    autoEnablePush();
    return () => { cancelled = true; };
  }, []);

  // Close notification panel on click outside or Escape
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event) {
      if (bellRef.current && bellRef.current.contains(event.target)) return;
      const panelEl = document.querySelector(".notification-panel");
      if (panelEl && panelEl.contains(event.target)) return;
      setOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
        bellRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    function positionPanel() {
      const rect = bellRef.current?.getBoundingClientRect();
      if (!rect) return;

      const panelWidth = Math.min(380, window.innerWidth - 24);
      // Always open below the bell button so it never blocks the button on mobile or desktop
      const top = Math.min(rect.bottom + 8, window.innerHeight - 180);
      const maxHeight = Math.max(180, window.innerHeight - top - 16);

      // On mobile or when bell is on the right side of the screen, align with the right
      let left;
      if (window.innerWidth <= 1024 || rect.left > window.innerWidth / 2) {
        left = rect.right - panelWidth;
      } else {
        left = rect.left;
      }

      // Clamp within screen boundaries with 12px margin
      if (left < 12) left = 12;
      if (left + panelWidth > window.innerWidth - 12) {
        left = window.innerWidth - panelWidth - 12;
      }

      setPanelPosition({ left, top, width: panelWidth, maxHeight });
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
      queryClient.setQueryData(queryKeys.notifications, (current) => current ? {
        ...current,
        notifications: current.notifications?.map((item) => (
          item.id === notification.id ? { ...item, is_read: true } : item
        )),
        unread_count: Math.max(0, (current.unread_count || 0) - (notification.is_read ? 0 : 1)),
      } : current);
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    } catch {
      // Navigation should still work if marking read fails temporarily.
    }
    setOpen(false);
    onSelect(notification);
  }

  async function handlePushDisable() {
    setPushBusy(true);
    setPushMessage("");
    try {
      if (!subscription) {
        setPushMessage("No push subscription to disable.");
        return;
      }
      await api.removePushSubscription(subscription.endpoint);
      await subscription.unsubscribe();
      setSubscription(null);
      setPushMessage("Push notifications disabled on this device.");
    } catch (error) {
      setPushMessage(error.message || "Could not disable push notifications.");
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
            {subscription && (
              <button type="button" onClick={handlePushDisable} disabled={pushBusy}>
                <FontAwesomeIcon icon={faBellSlash} />
                {pushBusy ? "Updating..." : "Disable push notifications"}
              </button>
            )}
            {pushMessage && <span role="status">{pushMessage}</span>}
          </footer>
        </section>,
        document.body
      )}
    </>
  );
}