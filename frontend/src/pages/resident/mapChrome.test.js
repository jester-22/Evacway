import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const styles = readFileSync(new URL("./ResidentHome.css", import.meta.url), "utf8");
const component = readFileSync(new URL("./ResidentHome.jsx", import.meta.url), "utf8");
const chromeStyles = styles.split("/* Public map chrome refresh */").at(-1);

test("global public map chrome uses the requested token-based surfaces and focus ring", () => {
  assert.match(chromeStyles, /color-mix\(in srgb, var\(--surface\) 95%, transparent\)/);
  assert.match(chromeStyles, /backdrop-filter:\s*blur\(12px\)/);
  assert.match(chromeStyles, /border-radius:\s*var\(--radius-pill\)/);
  assert.match(chromeStyles, /box-shadow:\s*var\(--shadow-focus\)/);
  assert.match(chromeStyles, /outline:\s*2px solid var\(--primary\)/);
  assert.match(chromeStyles, /\.right-control-stack[^}]*box-shadow:\s*var\(--shadow-md\)/s);
  assert.match(chromeStyles, /\.action-btn-sos::after[^}]*animation:\s*public-map-sos-pulse/s);
  assert.match(chromeStyles, /prefers-reduced-motion:\s*reduce[^}]*animation:\s*none/s);
  assert.doesNotMatch(chromeStyles, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("public map chrome icon controls keep accessible labels", () => {
  assert.match(component, /className="control-stack-btn"[\s\S]*?aria-label="My location"/);
  assert.match(component, /className="action-btn-circle action-btn-primary"[\s\S]*?aria-label=/);
  assert.match(component, /className="action-btn-circle action-btn-sos"[\s\S]*?aria-label="I need rescue"/);
});
