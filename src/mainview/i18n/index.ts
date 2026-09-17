/**
 * Locale runtime. Catalogs are static modules; `settings.locale` is the source of truth.
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

export const i18n = createI18n({
  legacy: false,
  locale: settings.value.locale,
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
  (locale) => {
    i18n.global.locale.value = locale;
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  },
  { immediate: true },
);
