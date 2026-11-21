import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const notice = readFileSync(new URL("./DataPrivacyNotice.jsx", import.meta.url), "utf8");

test("privacy notice identifies the Philippine privacy and cybercrime laws", () => {
  assert.match(notice, /Republic Act No\. 10173/);
  assert.match(notice, /Republic Act No\. 10175/);
  assert.match(notice, /Implementing Rules and Regulations/);
});

test("privacy notice covers data handling, data subject rights, and terms of use", () => {
  assert.match(notice, /Information EvacWay handles/);
  assert.match(notice, /Your data privacy rights/);
  assert.match(notice, /Terms of Use — draft/);
  assert.match(notice, /Draft for review — not yet approved/);
});

test("unknown legal and operational details remain marked for review", () => {
  assert.match(notice, /retention and deletion schedule/);
  assert.match(notice, /DPO\/privacy contact/);
  assert.match(notice, /lawful bases/);
});

test("privacy page close button closes its tab with a home-page fallback", () => {
  assert.match(notice, /function closeNoticeTab\(\)[\s\S]*window\.close\(\)/);
  assert.match(notice, /window\.location\.assign\("\/"\)/);
  assert.match(notice, /Close tab/);
});
