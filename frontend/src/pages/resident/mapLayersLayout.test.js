import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const styles = readFileSync(new URL("./ResidentHome.css", import.meta.url), "utf8");
const component = readFileSync(new URL("./ResidentHome.jsx", import.meta.url), "utf8");

test("map layers panel opens under the header and stays within the viewport", () => {
  assert.match(styles, /\.control-stack-layers-wrap \.map-layers-popover\s*\{[^}]*position:\s*fixed/);
  assert.match(styles, /\.control-stack-layers-wrap \.map-layers-popover\s*\{[^}]*top:\s*calc\(var\(--top-h, 52px\) \+ 8px\)/);
  assert.match(styles, /max-height:\s*min\(72vh, calc\(100dvh - var\(--top-h, 52px\) - 20px\)\)/);
});

test("map key is shown in Help, not in the layer toggle panel", () => {
  const helpPanelStart = component.indexOf("{/* Help panel: \"What do the icons mean?\" */}");
  const helpPanelEnd = component.indexOf("{/* Evacuation Center Bottom Card", helpPanelStart);
  const layersPanelStart = component.indexOf('className="map-layers-popover"');
  const layersPanelEnd = component.indexOf("</section>", layersPanelStart);
  const helpPanel = component.slice(helpPanelStart, helpPanelEnd);
  const layersPanel = component.slice(layersPanelStart, layersPanelEnd);

  assert.ok(helpPanel.includes('aria-label="Map key"'));
  assert.ok(helpPanel.includes("Sogod municipal boundary (blue dashed)"));
  assert.ok(!layersPanel.includes('aria-label="Map key"'));
  assert.match(styles, /\.help-popover\s*\{[^}]*max-height:\s*calc\(100dvh - 92px\)[^}]*overflow-y:\s*auto/);
});

test("saved offline map hover shows one confirmation without a duplicate tooltip", () => {
  const buttonStart = component.indexOf("offline-map-download-btn");
  const buttonEnd = component.indexOf("</button>", buttonStart);
  const downloadButton = component.slice(buttonStart, buttonEnd);

  assert.ok(!downloadButton.includes("title="));
  assert.match(downloadButton, /aria-label=/);
  assert.match(component, /Sogod map saved for offline use\./);
  assert.match(styles, /\.offline-map-download-btn\.active:hover \.map-control-tooltip[^}]*visibility:\s*hidden/);
});
