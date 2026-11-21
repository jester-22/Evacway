import english from "./landing.en.json" with { type: "json" };
import filipino from "./landing.fil.json" with { type: "json" };
import cebuano from "./landing.ceb.json" with { type: "json" };

export const landingLocales = {
  en: english,
  fil: filipino,
  ceb: cebuano,
};

export const landingLocaleOptions = [
  { value: "en", labelKey: "english" },
  { value: "fil", labelKey: "filipino" },
  { value: "ceb", labelKey: "cebuano" },
];

export function getLandingText(locale, key) {
  const dictionary = landingLocales[locale] || english;
  const value = key.split(".").reduce((current, segment) => current?.[segment], dictionary);
  return typeof value === "string" ? value : key.split(".").reduce((current, segment) => current?.[segment], english) || key;
}
