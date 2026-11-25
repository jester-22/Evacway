let stylesInjected = false;

function ensureAppDialogStyles() {
  if (stylesInjected || typeof document === "undefined") return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.id = "evacway-app-dialog-styles";
  style.textContent = `
    .ew-app-dialog-backdrop {
      position: fixed;
      inset: 0;
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background-color: rgba(15, 23, 42, 0.48);
      box-sizing: border-box;
      animation: ew-app-dialog-fade 140ms ease forwards;
    }
    .ew-app-dialog-card {
      width: min(440px, 100%);
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 22px 24px;
      border-radius: var(--radius-xl, 16px);
      border: 1px solid var(--border, #e2e8f0);
      background-color: var(--surface, #ffffff);
      box-shadow: var(--shadow-lg, 0 20px 25px -5px rgba(15, 23, 42, 0.14));
      color: var(--text, #0f172a);
      font-family: var(--font-body, 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif);
      box-sizing: border-box;
      animation: ew-app-dialog-pop 150ms ease forwards;
    }
    .ew-app-dialog-header {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .ew-app-dialog-icon {
      width: 40px;
      height: 40px;
      flex: 0 0 40px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      background-color: var(--primary-50, #eff6ff);
      color: var(--primary, #2563eb);
    }
    .ew-app-dialog-icon.is-success {
      background-color: var(--success-bg, #ecfdf5);
      color: var(--success-fg, #047857);
    }
    .ew-app-dialog-icon.is-warning {
      background-color: var(--warn-bg, #fffbeb);
      color: var(--warn-fg, #b45309);
    }
    .ew-app-dialog-icon.is-danger {
      background-color: var(--danger-bg, #fef2f2);
      color: var(--danger-fg, #b91c1c);
    }
    .ew-app-dialog-title {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      line-height: 1.3;
      color: var(--text, #0f172a);
    }
    .ew-app-dialog-message {
      margin: 0;
      font-size: 13.5px;
      line-height: 1.55;
      color: var(--text-2, #334155);
      white-space: pre-line;
    }
    .ew-app-dialog-list {
      margin: 0;
      padding: 10px 14px;
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 6px;
      border-radius: var(--radius-md, 10px);
      border: 1px solid var(--border, #e2e8f0);
      background-color: var(--bg, #f8fafc);
    }
    .ew-app-dialog-list li {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text, #0f172a);
    }
    .ew-app-dialog-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 4px;
    }
    .ew-app-dialog-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      height: 38px;
      padding: 0 16px;
      border-radius: var(--radius-md, 10px);
      border: 1px solid transparent;
      font-family: inherit;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease;
    }
    .ew-app-dialog-btn--secondary {
      background-color: var(--surface, #ffffff);
      border-color: var(--border, #e2e8f0);
      color: var(--text-2, #334155);
    }
    .ew-app-dialog-btn--secondary:hover {
      background-color: var(--bg, #f8fafc);
    }
    .ew-app-dialog-btn--primary {
      background-color: var(--primary, #2563eb);
      color: #ffffff;
    }
    .ew-app-dialog-btn--primary:hover {
      background-color: var(--primary-hover, #1d4ed8);
    }
    .ew-app-dialog-btn--danger {
      background-color: var(--danger, #dc2626);
      color: #ffffff;
    }
    .ew-app-dialog-btn--danger:hover {
      background-color: var(--danger-fg, #b91c1c);
    }
    @keyframes ew-app-dialog-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes ew-app-dialog-pop {
      from { opacity: 0; transform: translateY(6px) scale(0.99); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;
  document.head.appendChild(style);
}

function getIconSvg(tone) {
  if (tone === "success") {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
  }
  if (tone === "danger" || tone === "warning") {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
  }
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
}

function mountDialog({ title, message, tone = "info", items = [], confirmText = "OK", cancelText = null, danger = false }) {
  if (typeof document === "undefined") {
    return Promise.resolve(true);
  }
  ensureAppDialogStyles();

  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const backdrop = document.createElement("div");
    backdrop.className = "ew-app-dialog-backdrop";
    backdrop.setAttribute("role", "presentation");

    const card = document.createElement("section");
    card.className = "ew-app-dialog-card";
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "ew-app-dialog-header";

    const icon = document.createElement("span");
    icon.className = `ew-app-dialog-icon is-${danger ? "danger" : tone}`;
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = getIconSvg(danger ? "danger" : tone);

    const heading = document.createElement("h3");
    heading.className = "ew-app-dialog-title";
    heading.textContent = title;

    header.appendChild(icon);
    header.appendChild(heading);
    card.appendChild(header);

    if (message) {
      const p = document.createElement("p");
      p.className = "ew-app-dialog-message";
      p.textContent = message;
      card.appendChild(p);
    }

    if (Array.isArray(items) && items.length > 0) {
      const ul = document.createElement("ul");
      ul.className = "ew-app-dialog-list";
      items.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }

    const actions = document.createElement("div");
    actions.className = "ew-app-dialog-actions";

    let closed = false;
    function cleanup(result) {
      if (closed) return;
      closed = true;
      window.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();
      if (previousFocus && typeof previousFocus.focus === "function") {
        try {
          previousFocus.focus();
        } catch {
          // ignore focus restore errors
        }
      }
      resolve(result);
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cleanup(cancelText ? false : true);
      }
    }

    if (cancelText) {
      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "ew-app-dialog-btn ew-app-dialog-btn--secondary";
      cancelBtn.textContent = cancelText;
      cancelBtn.addEventListener("click", () => cleanup(false));
      actions.appendChild(cancelBtn);
    }

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = `ew-app-dialog-btn ${danger ? "ew-app-dialog-btn--danger" : "ew-app-dialog-btn--primary"}`;
    confirmBtn.textContent = confirmText;
    confirmBtn.addEventListener("click", () => cleanup(true));
    actions.appendChild(confirmBtn);

    card.appendChild(actions);
    backdrop.appendChild(card);

    backdrop.addEventListener("mousedown", (e) => {
      if (e.target === backdrop) {
        cleanup(cancelText ? false : true);
      }
    });

    window.addEventListener("keydown", onKeyDown, true);
    document.body.appendChild(backdrop);
    confirmBtn.focus();
  });
}

export function appAlert(message, options = {}) {
  return mountDialog({
    title: options.title || "Notice",
    message,
    tone: options.tone || "info",
    items: options.items || [],
    confirmText: options.confirmText || "OK",
    cancelText: null,
    danger: Boolean(options.danger),
  });
}

export function appConfirm(message, options = {}) {
  return mountDialog({
    title: options.title || "Confirm Action",
    message,
    tone: options.tone || (options.danger ? "danger" : "warning"),
    items: options.items || [],
    confirmText: options.confirmText || "Confirm",
    cancelText: options.cancelText || "Cancel",
    danger: Boolean(options.danger),
  });
}
