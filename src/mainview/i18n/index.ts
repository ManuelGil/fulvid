/**
 * Locale runtime. Catalogs are static modules; `settings.locale` is the source of truth.
 */
import { createI18n } from "vue-i18n";
import { watch } from "vue";

import { settings } from "../modules/settings/settingsStore";
import en from "./en";
import es from "./es";

export const i18n = createI18n({
  legacy: false,
  locale: settings.value.locale,
  fallbackLocale: "en",
  messages: {
    en,
    es,
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
