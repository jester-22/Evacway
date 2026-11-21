import test from "node:test";
import assert from "node:assert/strict";
import { getLandingText, landingLocaleOptions, landingLocales } from "./landing.js";

test("landing language choices include English, Filipino, and Cebuano", () => {
  assert.deepEqual(landingLocaleOptions.map(({ value }) => value), ["en", "fil", "ceb"]);
  assert.equal(getLandingText("fil", "hero.findCenter"), "Hanapin ang evacuation center ko");
  assert.equal(getLandingText("ceb", "hero.findCenter"), "Pangitaa ang akong evacuation center");
});

test("emergency and privacy translations are explicitly flagged for review", () => {
  for (const locale of ["fil", "ceb"]) {
    assert.ok(landingLocales[locale]._review_required.includes("operation.active"));
    assert.ok(landingLocales[locale]._review_required.includes("footer.privacy"));
  }
});

test("unknown locales fall back to English", () => {
  assert.equal(getLandingText("xx", "nav.signup"), "Sign up");
});

test("footer columns have labels in every landing locale", () => {
  for (const locale of ["en", "fil", "ceb"]) {
    assert.ok(getLandingText(locale, "footer.siteMap"));
    assert.ok(getLandingText(locale, "footer.contact"));
    assert.ok(getLandingText(locale, "footer.verifiedHotline"));
  }
});
