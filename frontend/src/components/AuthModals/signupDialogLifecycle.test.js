import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const authModals = readFileSync(new URL("./AuthModals.jsx", import.meta.url), "utf8");
const residentMap = readFileSync(new URL("../../pages/resident/ResidentHome.jsx", import.meta.url), "utf8");
const landingPage = readFileSync(new URL("../../pages/LandingPage.jsx", import.meta.url), "utf8");

test("resident sign-up dialog visibility follows its isOpen state", () => {
  assert.match(authModals, /if \(isOpen && !dialog\.open\)\s*\{\s*dialog\.showModal\(\);\s*\} else if \(!isOpen && dialog\.open\)\s*\{\s*dialog\.close\(\);/);
  assert.match(authModals, /function close\(\)\s*\{\s*const dialog = dialogRef\.current;\s*if \(dialog\?\.open\) dialog\.close\(\);[\s\S]*?handleClose\(\);/);
});

test("public map and landing page do not imperatively open sign-up outside its state", () => {
  const residentSignUpOpen = residentMap.match(/const openSignUpDialog = \(\) => \{([\s\S]*?)\n  \};/)?.[1] || "";
  const landingSignUpOpen = landingPage.match(/const openSignUp = \(\) => \{([\s\S]*?)\n  \};/)?.[1] || "";
  assert.match(residentSignUpOpen, /setSignUpOpen\(true\)/);
  assert.match(landingSignUpOpen, /setSignUpOpen\(true\)/);
  assert.doesNotMatch(residentSignUpOpen, /signUpDialogRef\.current\?\.showModal\(\)/);
  assert.doesNotMatch(landingSignUpOpen, /signUpDialogRef\.current\?\.showModal\(\)/);
});
