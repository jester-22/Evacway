import { Children, cloneElement, isValidElement, useEffect, useRef } from "react";
import "./PublicMapDialogShell.css";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function mergeClassName(className = "") {
  return [className, "public-map-dialog-panel"].filter(Boolean).join(" ");
}

export default function PublicMapDialogShell({
  children,
  onClose,
  labelledBy,
  ariaLabel,
  native = false,
  hasHandle = false,
}) {
  const backdropRef = useRef(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (native || !backdropRef.current) return undefined;

    const opener = document.activeElement;
    const panel = backdropRef.current.querySelector(".public-map-dialog-panel");
    const focusTarget = panel?.querySelector("[autofocus]")
      || panel?.querySelector("[aria-label^='Close']")
      || panel?.querySelector(FOCUSABLE)
      || panel;
    focusTarget?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab" || !panel) return;

      const focusable = [...panel.querySelectorAll(FOCUSABLE)].filter(
        (element) => element.getClientRects().length > 0,
      );
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected && typeof opener.focus === "function") opener.focus();
    };
  }, [native]);

  if (!isValidElement(children)) return null;

  const childProps = {
    className: mergeClassName(children.props.className),
    ...(native ? {} : {
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": labelledBy,
      "aria-label": labelledBy ? undefined : ariaLabel,
      tabIndex: children.props.tabIndex ?? -1,
    }),
  };

  if (native) {
    const dialogChildren = Children.toArray(children.props.children);
    return cloneElement(
      children,
      { ...childProps, "aria-modal": "true" },
      ...(!hasHandle ? [<div key="public-map-dialog-handle" className="public-map-dialog-handle" aria-hidden="true" />] : []),
      ...dialogChildren,
    );
  }

  return (
    <div
      ref={backdropRef}
      className="public-map-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current?.();
      }}
    >
      {cloneElement(
        children,
        childProps,
        ...(!hasHandle ? [<div key="public-map-dialog-handle" className="public-map-dialog-handle" aria-hidden="true" />] : []),
        ...Children.toArray(children.props.children),
      )}
    </div>
  );
}
