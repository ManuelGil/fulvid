/**
 * Locale runtime. Catalogs are static modules; `settings.locale` is the
 * preference source of truth. Active UI locale is resolved before mount:
 * explicit preference -> supported OS language -> English.
 */
import { createI18n } from "vue-i18n";
import { watch } from "vue";

import { settings } from "../modules/settings/settingsStore";
import de from "./de";
import en from "./en";
import es from "./es";
import fr from "./fr";
import it from "./it";
import nl from "./nl";
import pt from "./pt";
import { readOsLocaleTags, resolveLocalePreference } from "./resolveLocale";

const initialLocale = resolveLocalePreference(settings.value.locale, readOsLocaleTags());

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: "en",
  messages: {
    de,
    en,
    es,
    fr,
    it,
    nl,
    pt,
  },
});

watch(
  () => settings.value.locale,
  (preference) => {
    const locale = resolveLocalePreference(preference, readOsLocaleTags());
    i18n.global.locale.value = locale;
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  },
  { immediate: true },
);
