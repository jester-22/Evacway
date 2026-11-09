import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBell,
  faBellSlash,
  faCheck,
  faCircleCheck,
  faTriangleExclamation,
  faUserPlus,
  faLifeRing,
  faXmark,
  faSpinner,
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

async function getOrRegisterServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) {
    reg = await navigator.serviceWorker.register("/sw.js");
  }
  if (reg.active) return reg;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(reg), 1500);
    navigator.serviceWorker.ready.then((readyReg) => {
      clearTimeout(timer);
      resolve(readyReg);
    }).catch(() => {
      clearTimeout(timer);
      resolve(reg);
    });
  });
}

const PUSH_DISMISSED_KEY = "evacway_push_prompt_dismissed";

export default function NotificationCenter({ onSelect }) {
  const bellRef = useRef(null);
  const queryClient = useQueryClient();
  const notificationsQuery = useNotifications();
  const refetchNotifications = notificationsQuery.refetch;
  const notifications = notificationsQuery.data?.notifications || [];
  const unreadCount = notificationsQuery.data?.unread_count || 0;
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState(null);
  const [pushState, setPushState] = useState("checking"); // 'checking' | 'active' | 'inactive' | 'denied' | 'unsupported'
  const [pushMessage, setPushMessage] = useState("");
  const [pushBusy, setPushBusy] = useState(false);
  const [panelPosition, setPanelPosition] = useState(null);
  const [justActivated, setJustActivated] = useState(false);
  const [pushDismissed, setPushDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(PUSH_DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const seenIdsRef = useRef(null);

  useEffect(() => {
    if (!notificationsQuery.isSuccess) return;
    const currentIds = new Set(notifications.map((item) => item.id));
    if (seenIdsRef.current === null) {
      seenIdsRef.current = currentIds;
      return;
    }
    const newlyArrived = notifications.filter(
      (item) => !seenIdsRef.current.has(item.id)
    );
    seenIdsRef.current = currentIds;

    if (
      newlyArrived.length > 0 &&
      "Notification" in window &&
      Notification.permission === "granted"
    ) {
      newlyArrived.forEach((item) => {
        try {
          const browserNotif = new Notification(item.title || "EvacWay Notification", {
            body: item.message || "",
            tag: `evacway-notif-${item.id}`,
          });
          browserNotif.onclick = () => {
            window.focus();
            handleSelect(item);
            browserNotif.close();
          };
        } catch {
          // Ignore browser notification errors
        }
      });
    }
  }, [notifications, notificationsQuery.isSuccess]);

  useEffect(() => {
    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refetchNotifications();
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, [refetchNotifications]);

  // Check push subscription status on mount
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushState("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setPushState("denied");
      return;
    }

    let cancelled = false;

    async function checkSubscription() {
      try {
        const registration = await getOrRegisterServiceWorker();
        if (!registration) {
          if (!cancelled) setPushState("inactive");
          return;
        }
        const existing = await registration.pushManager.getSubscription();

        if (existing) {
          if (!cancelled) {
            setSubscription(existing);
            setPushState("active");
          }
          api.savePushSubscription(existing.toJSON()).catch(() => { });
          return;
        }

        // If permission was already granted previously, auto-subscribe silently
        if (Notification.permission === "granted") {
          const config = await api.getVapidPublicKey();
          if (config.enabled && config.public_key) {
            const created = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: decodeVapidKey(config.public_key),
            });
            await api.savePushSubscription(created.toJSON());
            if (!cancelled) {
              setSubscription(created);
              setPushState("active");
            }
            return;
          }
        }

        if (!cancelled) {
          setPushState("inactive");
        }
      } catch (err) {
        if (!cancelled) {
          setPushState("inactive");
        }
      }
    }

    checkSubscription();
    return () => { cancelled = true; };
  }, []);

  // Allow & Activate Push Notifications (User Gesture)
  const handlePushEnable = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setPushMessage("Push notifications are not supported by this browser.");
      setPushState("unsupported");
      return;
    }

    setPushBusy(true);
    setPushMessage("");

    try {
      // 1. Request browser permission on user click
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushState("denied");
        setPushMessage("Notification permission was not granted. You can allow it in browser site settings.");
        return;
      }

      // 2. Ready Service Worker
      const registration = await getOrRegisterServiceWorker();
      if (!registration) {
        throw new Error("Service worker could not be initialized.");
      }

      // 3. Get VAPID public key
      const config = await api.getVapidPublicKey();
      if (!config.enabled || !config.public_key) {
        setPushMessage("Web Push is not configured on the server.");
        return;
      }

      // 4. Subscribe
      let sub = await registration.pushManager.getSubscription();
      if (!sub) {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidKey(config.public_key),
        });
      }

      // 5. Save to backend
      await api.savePushSubscription(sub.toJSON());
      setSubscription(sub);
      setPushState("active");
      setJustActivated(true);
      setPushMessage("✓ Push notifications successfully activated!");

      // 6. Automatically hide after 2.5 seconds
      setTimeout(() => {
        setJustActivated(false);
        setPushMessage("");
      }, 2500);
    } catch (error) {
      console.error("Push activation failed:", error);
      setPushMessage(error.message || "Failed to activate push notifications.");
    } finally {
      setPushBusy(false);
    }
  }, []);

  // Disable push notifications
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
      setPushState("inactive");
      setPushMessage("Push notifications disabled on this device.");
    } catch (error) {
      setPushMessage(error.message || "Could not disable push notifications.");
    } finally {
      setPushBusy(false);
    }
  }

  function dismissPushPrompt() {
    setPushDismissed(true);
    try {
      sessionStorage.setItem(PUSH_DISMISSED_KEY, "true");
    } catch { }
  }

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

      const panelWidth = Math.min(390, window.innerWidth - 24);
      const top = Math.min(rect.bottom + 8, window.innerHeight - 180);
      const maxHeight = Math.max(180, window.innerHeight - top - 16);

      let left;
      if (window.innerWidth <= 1024 || rect.left > window.innerWidth / 2) {
        left = rect.right - panelWidth;
      } else {
        left = rect.left;
      }

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

  function removeNotificationFromCache(notification) {
    queryClient.setQueryData(queryKeys.notifications, (current) => {
      if (!current) return current;
      const nextList = (current.notifications || []).filter(
        (item) =>
          item.id !== notification.id &&
          !(
            notification.resource_type &&
            notification.resource_id != null &&
            item.resource_type === notification.resource_type &&
            item.resource_id === notification.resource_id
          )
      );
      return {
        ...current,
        notifications: nextList,
        unread_count: nextList.length,
      };
    });
  }

  async function handleSelect(notification) {
    removeNotificationFromCache(notification);
    setOpen(false);
    if (typeof onSelect === "function") {
      onSelect(notification);
    }
    try {
      await api.markNotificationRead(notification.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    } catch {
      // Navigation should still work if removing fails temporarily.
    }
  }

  async function handleDismissOne(event, notification) {
    event.stopPropagation();
    removeNotificationFromCache(notification);
    try {
      await api.markNotificationRead(notification.id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    } catch {
      // Ignore temporary errors
    }
  }

  async function handleClearAll() {
    queryClient.setQueryData(queryKeys.notifications, (current) =>
      current ? { ...current, notifications: [], unread_count: 0 } : current
    );
    try {
      await api.clearAllNotifications();
      await queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    } catch {
      // Ignore temporary errors
    }
  }

  function renderNotificationIcon(notification) {
    if (notification.is_emergency) {
      return <FontAwesomeIcon icon={faTriangleExclamation} />;
    }
    if (notification.resource_type === "resident_registration" || notification.resource_type === "resident_account") {
      return <FontAwesomeIcon icon={faUserPlus} />;
    }
    if (notification.resource_type === "rescue_request") {
      return <FontAwesomeIcon icon={faLifeRing} />;
    }
    if (notification.resource_type === "hazard_report") {
      return <FontAwesomeIcon icon={faTriangleExclamation} />;
    }
    return <FontAwesomeIcon icon={faCheck} />;
  }

  const isPushActive = pushState === "active" && Boolean(subscription);
  const showPushPrompt = (!isPushActive && !pushDismissed && pushState !== "unsupported") || justActivated;

  return (
    <>
      <div className="notification-center">
        <button
          ref={bellRef}
          type="button"
          className={`notification-bell ${!isPushActive ? "has-push-warning" : ""}`}
          aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          title={!isPushActive ? "Notifications (Push alerts inactive on this device)" : "Notifications"}
        >
          <FontAwesomeIcon icon={faBell} />
          {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span>}
          {!isPushActive && unreadCount === 0 && <span className="notification-dot-inactive" title="Push notifications inactive" />}
        </button>
      </div>

      {open && panelPosition && createPortal(
        <section className="notification-panel" style={panelPosition} aria-label="Notifications">
          <header className="notification-panel-head">
            <div className="notification-head-left">
              <h2>Notifications</h2>
              <span className="notification-unread-pill">{unreadCount} unread</span>
            </div>
            <div className="notification-head-right">
              {notifications.length > 0 && (
                <button
                  type="button"
                  className="notification-clear-all-btn"
                  onClick={handleClearAll}
                  title="Remove all notifications"
                >
                  Clear all
                </button>
              )}
              {isPushActive && (
                <span className="notification-push-badge is-active" title="Push notifications active on this browser">
                  <FontAwesomeIcon icon={faCircleCheck} /> Push Active
                </span>
              )}
            </div>
          </header>

          {/* Push Activation Prompt Banner (Hides once activated) */}
          {showPushPrompt && (
            <div className={`notification-push-banner ${justActivated ? "is-success" : ""}`}>
              {justActivated ? (
                <div className="notification-push-success-msg">
                  <FontAwesomeIcon icon={faCircleCheck} className="text-emerald-500" />
                  <span>Push notifications activated! You'll receive real-time alerts.</span>
                </div>
              ) : (
                <>
                  <div className="notification-push-banner-body">
                    <div className="notification-push-banner-title">
                      <FontAwesomeIcon icon={faBell} className="text-blue-600" />
                      <strong>Activate Push Notifications</strong>
                    </div>
                    <p>
                      Receive instant alerts when resident registrations or emergency rescues arrive.
                    </p>
                  </div>
                  <div className="notification-push-banner-actions">
                    <button
                      type="button"
                      className="notification-push-allow-btn"
                      onClick={handlePushEnable}
                      disabled={pushBusy}
                    >
                      {pushBusy ? (
                        <>
                          <FontAwesomeIcon icon={faSpinner} spin /> Activating...
                        </>
                      ) : (
                        "Allow & Activate"
                      )}
                    </button>
                    <button
                      type="button"
                      className="notification-push-close-btn"
                      onClick={dismissPushPrompt}
                      title="Dismiss for this session"
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="notification-list">
            {notifications.length === 0 ? (
              <p className="notification-empty">No notifications yet.</p>
            ) : notifications.map((notification) => {
              const isResident = notification.resource_type === "resident_registration" || notification.resource_type === "resident_account";
              return (
                <div
                  key={notification.id}
                  className={`notification-item ${notification.is_read ? "is-read" : "is-unread"} ${notification.is_emergency ? "is-emergency" : isResident ? "is-resident" : ""
                    }`}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelect(notification)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSelect(notification);
                    }
                  }}
                >
                  <span className="notification-item-icon">
                    {renderNotificationIcon(notification)}
                  </span>
                  <span className="notification-item-copy">
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <small>{notification.created_at ? new Date(notification.created_at).toLocaleString() : ""}</small>
                  </span>
                  <button
                    type="button"
                    className="notification-item-dismiss"
                    onClick={(e) => handleDismissOne(e, notification)}
                    aria-label="Remove notification"
                    title="Remove notification"
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </div>
              );
            })}
          </div>

          <footer className="notification-panel-footer">
            {isPushActive ? (
              <button type="button" onClick={handlePushDisable} disabled={pushBusy} className="notification-push-toggle">
                <FontAwesomeIcon icon={faBellSlash} />
                {pushBusy ? "Updating..." : "Disable push notifications"}
              </button>
            ) : pushState !== "unsupported" ? (
              <button type="button" onClick={handlePushEnable} disabled={pushBusy} className="notification-push-toggle is-enable">
                <FontAwesomeIcon icon={faBell} />
                {pushBusy ? "Activating..." : "Enable push notifications"}
              </button>
            ) : null}
            {pushMessage && !justActivated && <span className="notification-push-status" role="status">{pushMessage}</span>}
          </footer>
        </section>,
        document.body
      )}
    </>
  );
}
