import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const shell = readFileSync(new URL("./PublicMapDialogShell.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./PublicMapDialogShell.css", import.meta.url), "utf8");
const residentMap = readFileSync(new URL("../../pages/resident/ResidentHome.jsx", import.meta.url), "utf8");
const authModals = readFileSync(new URL("../AuthModals/AuthModals.jsx", import.meta.url), "utf8");

test("public map dialog shell provides labelled dialog semantics and keyboard focus handling", () => {
  assert.match(shell, /role:\s*"dialog"/);
  assert.match(shell, /"aria-modal":\s*"true"/);
  assert.match(shell, /"aria-labelledby":\s*labelledBy/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /event\.key !== "Tab"/);
  assert.match(shell, /opener\.focus\(\)/);
});

test("public map dialog shell uses the requested desktop and mobile treatment", () => {
  assert.match(styles, /rgba\(15, 23, 42, 0\.45\)/);
  assert.match(styles, /var\(--radius-2xl\)/);
  assert.match(styles, /var\(--shadow-lg\)/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /max-height:\s*85vh/);
  assert.match(styles, /env\(safe-area-inset-bottom/);
  assert.match(styles, /public-map-sheet-in 200ms/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test("centered public map dialogs and native auth dialogs use the shared shell", () => {
  for (const label of [
    "My evacuation center",
    "Family search preference",
    "Find someone",
    "Evacuation Center Bottom Card",
  ]) {
    assert.ok(residentMap.includes(label));
  }
  assert.ok(residentMap.includes("<PublicMapDialogShell"));
  assert.match(authModals, /<PublicMapDialogShell native labelledBy="ew-signup-title"/);
  assert.match(authModals, /<PublicMapDialogShell native labelledBy="ew-login-title"/);
});

test("native public map dialogs stay hidden unless open", () => {
  assert.match(styles, /dialog\.public-map-dialog-panel:not\(\[open\]\)\s*\{\s*display:\s*none;/);
  assert.match(styles, /dialog\.public-map-dialog-panel\[open\]/);
  assert.doesNotMatch(styles, /dialog\.public-map-dialog-panel\s*\{/);
});
