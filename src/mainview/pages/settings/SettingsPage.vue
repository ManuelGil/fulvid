<script setup lang="ts">
/**
 * Single Settings surface. Categories switch in-page via `?section=` (one
 * panel at a time). Local Settings Search projects catalog metadata onto the
 * real controls; writes still go only through `patchSettings` /
 * `resetSettingsToDefaults`.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import PageShell from "../../shell/PageShell.vue";
import {
  patchSettings,
  resetSettingsToDefaults,
  settings,
} from "../../modules/settings/settingsStore";
import type { FulvidSettings, StatusbarIndicator } from "../../modules/settings/settingsStore";
import {
  focusSettingsSearchTarget,
  matchSettingsSearch,
} from "../../modules/settings/settingsSearch";
import { settingsCategoryNavDelta } from "../../modules/settings/settingsCategoryNav";
import { syncDocumentAnnotationsVisibleFromPreference } from "../../modules/editor/document/documentAnnotationVisibility";
import { discoveredExtensions, setDiscoveredExtensions } from "../../extensions/extensionRegistry";
import { confirmDialog } from "../../app/dialogs";
import { notify } from "../../app/notify";
import { desktopRequest } from "../../desktop/electrobunClient";
import {
  THEME_FAMILIES,
  themeOptionsForFamily,
  type ThemeOption,
} from "../../modules/editor/monaco/monacoThemes";
import {
  author as APP_AUTHOR,
  license as APP_LICENSE,
  version as APP_VERSION,
  sponsor as APP_SPONSOR,
} from "../../../../package.json";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

type SettingsCategory =
  | "language"
  | "editorText"
  | "editing"
  | "files"
  | "editorDisplay"
  | "writing"
  | "theme"
  | "interface"
  | "accessibility"
  | "statusbar"
  | "folder"
  | "links"
  | "context"
  | "preview"
  | "extensions"
  | "keyboard"
  | "about";

const SETTINGS_CATEGORIES = [
  { id: "language", label: "settings.language" },
  { id: "editorText", label: "settings.editorText" },
  { id: "editing", label: "settings.editing" },
  { id: "files", label: "settings.files" },
  { id: "editorDisplay", label: "settings.editorDisplay" },
  { id: "writing", label: "settings.writing" },
  { id: "theme", label: "settings.themeCategory" },
  { id: "interface", label: "settings.interface" },
  { id: "accessibility", label: "settings.accessibility" },
  { id: "statusbar", label: "settings.statusbar" },
  { id: "folder", label: "settings.folder" },
  { id: "links", label: "settings.links" },
  { id: "context", label: "settings.context" },
  { id: "preview", label: "settings.preview" },
  { id: "extensions", label: "settings.extensions" },
  { id: "keyboard", label: "settings.keyboard" },
  { id: "about", label: "settings.about" },
] as const;

const SETTINGS_NAV_GROUPS = [
  { label: "settings.navApplication", categories: SETTINGS_CATEGORIES.slice(0, 1) },
  { label: "settings.navEditor", categories: SETTINGS_CATEGORIES.slice(1, 6) },
  { label: "settings.navAppearance", categories: SETTINGS_CATEGORIES.slice(6, 10) },
  { label: "settings.navFolder", categories: SETTINGS_CATEGORIES.slice(10, 11) },
  { label: "settings.navMarkdown", categories: SETTINGS_CATEGORIES.slice(11, 14) },
  { label: "settings.navExtensions", categories: SETTINGS_CATEGORIES.slice(14, 15) },
  { label: "settings.navInformation", categories: SETTINGS_CATEGORIES.slice(15, 17) },
] as const;

const STATUSBAR_INDICATORS: readonly {
  key: StatusbarIndicator;
  label: string;
  hint: string;
}[] = [
  {
    key: "document",
    label: "settings.statusbarDocument",
    hint: "settings.statusbarDocumentHint",
  },
  {
    key: "language",
    label: "settings.statusbarLanguage",
    hint: "settings.statusbarLanguageHint",
  },
  {
    key: "linkMode",
    label: "settings.statusbarLinkMode",
    hint: "settings.statusbarLinkModeHint",
  },
  {
    key: "workspace",
    label: "settings.statusbarWorkspace",
    hint: "settings.statusbarWorkspaceHint",
  },
  {
    key: "characters",
    label: "settings.statusbarCharacters",
    hint: "settings.statusbarCharactersHint",
  },
  {
    key: "eol",
    label: "settings.statusbarEol",
    hint: "settings.statusbarEolHint",
  },
];

const DENSITY_OPTIONS: readonly {
  id: FulvidSettings["appearance"]["density"];
  label: string;
  hint: string;
}[] = [
  {
    id: "normal",
    label: "settings.densityNormal",
    hint: "settings.densityNormalHint",
  },
  {
    id: "compact",
    label: "settings.densityCompact",
    hint: "settings.densityCompactHint",
  },
];

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const SECTION_ALIASES: Record<string, SettingsCategory> = {
  general: "language",
  editor: "editorText",
  appearance: "theme",
  workspace: "folder",
  markdown: "links",
  help: "keyboard",
};

function categoryFromRoute(value: unknown): SettingsCategory {
  if (typeof value === "string") {
    const aliased = SECTION_ALIASES[value];
    if (aliased) {
      return aliased;
    }
    if (SETTINGS_CATEGORIES.some((category) => category.id === value)) {
      return value as SettingsCategory;
    }
  }
  return "language";
}

const selectedCategory = ref<SettingsCategory>(categoryFromRoute(route.query.section));
const compactCategoryNav = ref(false);
let compactCategoryNavMedia: MediaQueryList | null = null;

/** Local UI state only - never persisted. */
const searchQuery = ref("");
const searchSelectedIndex = ref(0);

const categoryTabOrientation = computed(() =>
  compactCategoryNav.value ? "horizontal" : "vertical",
);

const searchActive = computed(() => searchQuery.value.trim().length > 0);
const searchResults = computed(() => matchSettingsSearch(searchQuery.value, t));
const searchActiveOptionId = computed(() => {
  if (!searchActive.value || searchResults.value.length === 0) {
    return undefined;
  }
  return `settings-search-option-${searchSelectedIndex.value}`;
});

watch(searchResults, (results) => {
  if (results.length === 0) {
    searchSelectedIndex.value = 0;
    return;
  }
  searchSelectedIndex.value = Math.min(searchSelectedIndex.value, results.length - 1);
});

watch(
  () => route.query.section,
  (section) => {
    const category = categoryFromRoute(section);
    selectedCategory.value = category;
    void nextTick(() => {
      document
        .querySelector<HTMLElement>(`[data-settings-category="${category}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  },
);

function clearSettingsSearch(): void {
  searchQuery.value = "";
  searchSelectedIndex.value = 0;
}

function selectCategory(category: SettingsCategory): void {
  clearSettingsSearch();
  selectedCategory.value = category;
  void router.replace({
    query: {
      ...route.query,
      section: category,
    },
  });
  void nextTick(() => {
    document
      .querySelector<HTMLElement>(`[data-settings-category="${category}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const content = document.querySelector<HTMLElement>(".settings-page__content");
    if (content) {
      content.scrollTop = 0;
    }
  });
}

function categoryIndex(category: SettingsCategory): number {
  return SETTINGS_CATEGORIES.findIndex((item) => item.id === category);
}

const installedExtensions = computed(() => discoveredExtensions.value.installed);
const extensionsBusy = ref(false);

function extensionStateLabel(state: string): string {
  if (state === "loaded") {
    return t("settings.extensionStateLoaded");
  }
  if (state === "allowed") {
    return t("settings.extensionStateAllowed");
  }
  if (state === "blocked") {
    return t("settings.extensionStateBlocked");
  }
  if (state === "failed") {
    return t("settings.extensionStateFailed");
  }
  return state;
}

function extensionMetaLine(pack: (typeof installedExtensions.value)[number]): string {
  const parts = [pack.id, pack.version];
  if (pack.author) {
    parts.push(pack.author);
  }
  if (pack.license) {
    parts.push(pack.license);
  }
  return parts.join(", ");
}

async function openExtensionFolder(extensionId: string): Promise<void> {
  try {
    const ok = await desktopRequest().revealExtensionPack({ id: extensionId });
    if (!ok) {
      notify(t("settings.extensionOpenFolderFailed"));
    }
  } catch {
    notify(t("settings.extensionOpenFolderFailed"));
  }
}

async function reviewBlockedExtension(extensionId: string): Promise<void> {
  const pack = installedExtensions.value.find((entry) => entry.id === extensionId);
  if (!pack || (pack.state !== "blocked" && pack.state !== "failed")) {
    return;
  }
  const confirmed = await confirmDialog(
    t("settings.extensionAllowMessage", {
      name: pack.displayName,
      id: pack.id,
      reason: pack.reason ?? t("settings.extensionUnknownReason"),
    }),
    {
      title: t("settings.extensionAllowTitle"),
      confirmLabel: t("settings.extensionAllowConfirm"),
      initialFocus: "cancel",
    },
  );
  if (!confirmed) {
    return;
  }
  extensionsBusy.value = true;
  try {
    const result = await desktopRequest().allowBlockedExtension({ id: extensionId });
    setDiscoveredExtensions(result);
    const updated = result.installed.find((entry) => entry.id === extensionId);
    if (updated && (updated.state === "loaded" || updated.state === "allowed")) {
      notify(t("settings.extensionAllowSucceeded", { id: extensionId }));
    } else {
      notify(
        t("settings.extensionAllowStillFailed", {
          id: extensionId,
          reason: updated?.reason ?? pack.reason ?? "",
        }),
      );
    }
  } catch {
    notify(t("settings.extensionAllowFailed"));
  } finally {
    extensionsBusy.value = false;
  }
}

async function installExtensionPack(): Promise<void> {
  if (extensionsBusy.value) {
    return;
  }
  extensionsBusy.value = true;
  try {
    const result = await desktopRequest().installExtensionPack({});
    if (result.status === "cancelled") {
      return;
    }
    setDiscoveredExtensions(result.discovery);
    if (result.status === "ok") {
      notify(t("settings.extensionInstallSucceeded", { id: result.id }));
      return;
    }
    notify(t("settings.extensionInstallFailed", { reason: result.reason }));
  } catch {
    notify(t("settings.extensionInstallFailed", { reason: t("settings.extensionUnknownReason") }));
  } finally {
    extensionsBusy.value = false;
  }
}

async function uninstallExtensionPack(extensionId: string): Promise<void> {
  const pack = installedExtensions.value.find((entry) => entry.id === extensionId);
  if (!pack || extensionsBusy.value) {
    return;
  }
  const confirmed = await confirmDialog(
    t("settings.extensionUninstallMessage", {
      name: pack.displayName,
      id: pack.id,
    }),
    {
      title: t("settings.extensionUninstallTitle"),
      confirmLabel: t("settings.extensionUninstallConfirm"),
      initialFocus: "cancel",
    },
  );
  if (!confirmed) {
    return;
  }
  extensionsBusy.value = true;
  try {
    const result = await desktopRequest().uninstallExtensionPack({ id: extensionId });
    setDiscoveredExtensions(result.discovery);
    if (result.status === "ok") {
      notify(t("settings.extensionUninstallSucceeded", { id: extensionId }));
      return;
    }
    notify(t("settings.extensionUninstallFailed", { reason: result.reason }));
  } catch {
    notify(
      t("settings.extensionUninstallFailed", { reason: t("settings.extensionUnknownReason") }),
    );
  } finally {
    extensionsBusy.value = false;
  }
}

async function rediscoverExtensions(): Promise<void> {
  if (extensionsBusy.value) {
    return;
  }
  extensionsBusy.value = true;
  try {
    const result = await desktopRequest().rediscoverExtensions({});
    setDiscoveredExtensions(result);
    notify(t("settings.extensionRediscoverSucceeded"));
  } catch {
    notify(t("settings.extensionRediscoverFailed"));
  } finally {
    extensionsBusy.value = false;
  }
}

async function activateSettingsSearchResult(index: number): Promise<void> {
  const hit = searchResults.value[index];
  if (!hit) {
    return;
  }
  const { id, category } = hit;
  // Switch category while results still hide the panel, then reveal the target.
  selectedCategory.value = category;
  await router.replace({
    query: {
      ...route.query,
      section: category,
    },
  });
  clearSettingsSearch();
  await nextTick();
  await nextTick();
  focusSettingsSearchTarget(id);
}

function onSettingsSearchKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    if (!searchQuery.value) {
      return;
    }
    event.preventDefault();
    clearSettingsSearch();
    return;
  }

  if (!searchActive.value) {
    return;
  }

  const lastIndex = searchResults.value.length - 1;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (lastIndex < 0) {
      return;
    }
    searchSelectedIndex.value = Math.min(searchSelectedIndex.value + 1, lastIndex);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (lastIndex < 0) {
      return;
    }
    searchSelectedIndex.value = Math.max(searchSelectedIndex.value - 1, 0);
    return;
  }
  if (event.key === "Enter") {
    if (lastIndex < 0) {
      return;
    }
    event.preventDefault();
    void activateSettingsSearchResult(searchSelectedIndex.value);
  }
}

function onCategoryKeydown(event: KeyboardEvent, index: number): void {
  const delta = settingsCategoryNavDelta(event.key, compactCategoryNav.value);
  if (delta === 0 && !["Home", "End"].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const lastIndex = SETTINGS_CATEGORIES.length - 1;
  const nextIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? lastIndex
        : Math.min(Math.max(index + delta, 0), lastIndex);
  const nextCategory = SETTINGS_CATEGORIES[nextIndex];
  if (!nextCategory) {
    return;
  }
  selectCategory(nextCategory.id);
  void nextTick(() => {
    const item = document.querySelector<HTMLElement>(
      `[data-settings-category="${nextCategory.id}"]`,
    );
    item?.focus({ preventScroll: true });
    item?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

function onCompactCategoryNavChange(event: MediaQueryListEvent): void {
  compactCategoryNav.value = event.matches;
}

onMounted(() => {
  compactCategoryNavMedia = window.matchMedia("(max-width: 520px)");
  compactCategoryNav.value = compactCategoryNavMedia.matches;
  compactCategoryNavMedia.addEventListener("change", onCompactCategoryNavChange);
  void nextTick(() => {
    document
      .querySelector<HTMLElement>(`[data-settings-category="${selectedCategory.value}"]`)
      ?.focus({ preventScroll: true });
  });
});

onBeforeUnmount(() => {
  compactCategoryNavMedia?.removeEventListener("change", onCompactCategoryNavChange);
  compactCategoryNavMedia = null;
});

const isApplePlatform = computed(
  () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform),
);
const primaryModifier = computed(() => (isApplePlatform.value ? "Cmd" : "Ctrl"));

function setAppearance<K extends keyof FulvidSettings["appearance"]>(
  key: K,
  value: FulvidSettings["appearance"][K],
): void {
  patchSettings({ appearance: { ...settings.value.appearance, [key]: value } });
}

function setTheme(theme: ThemeOption["id"]): void {
  setAppearance("theme", theme);
}

function setEditor<K extends keyof FulvidSettings["editor"]>(
  key: K,
  value: FulvidSettings["editor"][K],
): void {
  patchSettings({ editor: { ...settings.value.editor, [key]: value } });
  if (key === "showDocumentAnnotations" && typeof value === "boolean") {
    syncDocumentAnnotationsVisibleFromPreference(value);
  }
}

function setStatusbarEnabled(enabled: boolean): void {
  patchSettings({
    appearance: {
      ...settings.value.appearance,
      statusbar: {
        ...settings.value.appearance.statusbar,
        enabled,
      },
    },
  });
}

function setStatusbarIndicator(key: StatusbarIndicator, value: boolean): void {
  patchSettings({
    appearance: {
      ...settings.value.appearance,
      statusbar: {
        ...settings.value.appearance.statusbar,
        indicators: {
          ...settings.value.appearance.statusbar.indicators,
          [key]: value,
        },
      },
    },
  });
}

function setWorkspacePref<K extends keyof FulvidSettings["workspace"]>(
  key: K,
  value: FulvidSettings["workspace"][K],
): void {
  patchSettings({ workspace: { ...settings.value.workspace, [key]: value } });
}

function setLinkPref<K extends keyof FulvidSettings["links"]>(
  key: K,
  value: FulvidSettings["links"][K],
): void {
  patchSettings({ links: { ...settings.value.links, [key]: value } });
}

function setLinkMode(mode: FulvidSettings["links"]["linkMode"]): void {
  setLinkPref("linkMode", mode);
}

function setPreviewEnabled(enabled: boolean): void {
  patchSettings({ preview: { ...settings.value.preview, enabled } });
}

function setLocale(locale: FulvidSettings["locale"]): void {
  patchSettings({ locale });
}

async function onResetSettings(): Promise<void> {
  const confirmed = await confirmDialog(t("settings.resetToDefaultsMessage"), {
    title: t("settings.resetToDefaultsTitle"),
    confirmLabel: t("settings.resetToDefaultsConfirm"),
    initialFocus: "cancel",
  });
  if (!confirmed) {
    return;
  }
  resetSettingsToDefaults();
  syncDocumentAnnotationsVisibleFromPreference(settings.value.editor.showDocumentAnnotations);
  notify(t("settings.resetToDefaultsDone"));
}

async function onOpenSponsorPage(): Promise<void> {
  try {
    await desktopRequest().openSponsorPage({});
  } catch {
    // Host unavailable; keep the href for copy or OS handling.
  }
}
</script>

<template>
  <PageShell :title="t('settings.title')" wide fill>
    <div class="settings-layout">
      <nav
        class="settings-category-nav"
        role="tablist"
        :aria-orientation="categoryTabOrientation"
        :aria-label="t('settings.title')"
      >
        <div
          v-for="group in SETTINGS_NAV_GROUPS"
          :key="group.label"
          class="settings-category-nav__group"
        >
          <h2 class="settings-category-nav__group-label">{{ t(group.label) }}</h2>
          <button
            v-for="category in group.categories"
            :id="`settings-category-${category.id}`"
            :key="category.id"
            type="button"
            role="tab"
            :data-settings-category="category.id"
            class="settings-category-nav__item"
            :class="{ 'is-active': selectedCategory === category.id }"
            :aria-selected="selectedCategory === category.id"
            :aria-controls="searchActive ? undefined : 'settings-panel'"
            :tabindex="selectedCategory === category.id ? 0 : -1"
            @click="selectCategory(category.id)"
            @keydown="onCategoryKeydown($event, categoryIndex(category.id))"
          >
            {{ t(category.label) }}
          </button>
        </div>
      </nav>

      <div class="settings-page__content">
        <div class="settings-search">
          <label class="settings-search__field">
            <span class="sr-only">{{ t("settings.searchLabel") }}</span>
            <input
              id="settings-search-query"
              v-model="searchQuery"
              class="settings-search__input"
              type="search"
              spellcheck="false"
              autocomplete="off"
              :placeholder="t('settings.searchPlaceholder')"
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              :aria-controls="
                searchActive && searchResults.length > 0 ? 'settings-search-results' : undefined
              "
              :aria-expanded="searchActive && searchResults.length > 0"
              :aria-activedescendant="searchActiveOptionId"
              @keydown="onSettingsSearchKeydown"
            />
          </label>
          <button
            v-if="searchQuery"
            type="button"
            class="settings-search__clear"
            :aria-label="t('settings.searchClear')"
            @click="clearSettingsSearch"
          >
            {{ t("settings.searchClear") }}
          </button>
        </div>

        <div
          v-if="searchActive"
          class="settings-search-panel"
          role="region"
          :aria-label="t('settings.searchResults')"
        >
          <p v-if="searchResults.length === 0" class="settings-search-empty" role="status">
            {{ t("settings.searchNoResults", { query: searchQuery.trim() }) }}
          </p>
          <ul
            v-else
            id="settings-search-results"
            class="settings-search-results"
            role="listbox"
            :aria-label="t('settings.searchResults')"
          >
            <li
              v-for="(result, index) in searchResults"
              :id="`settings-search-option-${index}`"
              :key="result.id"
              role="option"
              class="settings-search-results__item"
              :class="{ 'is-selected': searchSelectedIndex === index }"
              :aria-selected="searchSelectedIndex === index"
              @pointerdown.prevent="activateSettingsSearchResult(index)"
            >
              <span class="settings-search-results__category">{{ result.categoryLabel }}</span>
              <span class="settings-search-results__label">{{ result.label }}</span>
              <span v-if="result.hint" class="settings-search-results__hint">{{
                result.hint
              }}</span>
            </li>
          </ul>
        </div>

        <div
          v-else
          id="settings-panel"
          class="settings-page__sections"
          role="tabpanel"
          tabindex="-1"
          :aria-labelledby="`settings-category-${selectedCategory}`"
        >
          <section
            v-if="selectedCategory === 'language'"
            class="settings-section"
            aria-labelledby="settings-language"
          >
            <h2 id="settings-language" class="settings-section__title">
              {{ t("settings.language") }}
            </h2>
            <label class="settings-option" data-settings-id="general.locale">
              <span class="settings-option__copy">
                <span class="settings-option__name">{{ t("settings.locale") }}</span>
                <span id="settings-locale-hint" class="settings-option__hint">
                  {{ t("settings.localeHint") }}
                </span>
              </span>
              <select
                :value="settings.locale"
                :aria-label="t('settings.locale')"
                aria-describedby="settings-locale-hint"
                @change="
                  setLocale(($event.target as HTMLSelectElement).value as FulvidSettings['locale'])
                "
              >
                <option value="de">{{ t("settings.german") }}</option>
                <option value="en">{{ t("settings.english") }}</option>
                <option value="es">{{ t("settings.spanish") }}</option>
                <option value="fr">{{ t("settings.french") }}</option>
                <option value="it">{{ t("settings.italian") }}</option>
                <option value="nl">{{ t("settings.dutch") }}</option>
                <option value="pt">{{ t("settings.portuguese") }}</option>
              </select>
            </label>
          </section>

          <section
            v-if="selectedCategory === 'editorText'"
            class="settings-section"
            aria-labelledby="settings-editorText"
          >
            <h2 id="settings-editorText" class="settings-section__title">
              {{ t("settings.editorText") }}
            </h2>
            <fieldset class="settings-field">
              <legend class="settings-field__label">{{ t("settings.editorTypography") }}</legend>
              <label class="settings-option" data-settings-id="editor.fontSize">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorFontSize") }}</span>
                  <span id="settings-editor-font-size-hint" class="settings-option__hint">
                    {{ t("settings.editorFontSizeHint") }}
                  </span>
                </span>
                <input
                  class="settings-option__number"
                  type="number"
                  min="10"
                  max="24"
                  step="1"
                  :value="settings.editor.fontSize"
                  :aria-label="t('settings.editorFontSize')"
                  aria-describedby="settings-editor-font-size-hint"
                  @change="setEditor('fontSize', Number(($event.target as HTMLInputElement).value))"
                />
              </label>

              <label class="settings-option" data-settings-id="editor.fontFamily">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorFontFamily") }}</span>
                  <span id="settings-editor-font-family-hint" class="settings-option__hint">
                    {{ t("settings.editorFontFamilyHint") }}
                  </span>
                </span>
                <select
                  :value="settings.editor.fontFamily"
                  :aria-label="t('settings.editorFontFamily')"
                  aria-describedby="settings-editor-font-family-hint"
                  @change="
                    setEditor(
                      'fontFamily',
                      ($event.target as HTMLSelectElement)
                        .value as FulvidSettings['editor']['fontFamily'],
                    )
                  "
                >
                  <option value="monospace">{{ t("settings.editorFontFamilyMonospace") }}</option>
                  <option value="system">{{ t("settings.editorFontFamilySystem") }}</option>
                  <option value="serif">{{ t("settings.editorFontFamilySerif") }}</option>
                </select>
              </label>

              <label class="settings-option" data-settings-id="editor.lineHeight">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorLineHeight") }}</span>
                  <span id="settings-editor-line-height-hint" class="settings-option__hint">
                    {{ t("settings.editorLineHeightHint") }}
                  </span>
                </span>
                <select
                  :value="settings.editor.lineHeight"
                  :aria-label="t('settings.editorLineHeight')"
                  aria-describedby="settings-editor-line-height-hint"
                  @change="
                    setEditor(
                      'lineHeight',
                      ($event.target as HTMLSelectElement)
                        .value as FulvidSettings['editor']['lineHeight'],
                    )
                  "
                >
                  <option value="auto">{{ t("settings.editorLineHeightAuto") }}</option>
                  <option value="compact">{{ t("settings.editorLineHeightCompact") }}</option>
                  <option value="comfortable">
                    {{ t("settings.editorLineHeightComfortable") }}
                  </option>
                </select>
              </label>
            </fieldset>
          </section>

          <section
            v-if="selectedCategory === 'editing'"
            class="settings-section"
            aria-labelledby="settings-editing"
          >
            <h2 id="settings-editing" class="settings-section__title">
              {{ t("settings.editing") }}
            </h2>
            <fieldset class="settings-field">
              <legend class="sr-only">{{ t("settings.editing") }}</legend>

              <label class="settings-option" data-settings-id="editor.tabSize">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorTabSize") }}</span>
                  <span id="settings-editor-tab-size-hint" class="settings-option__hint">
                    {{ t("settings.editorTabSizeHint") }}
                  </span>
                </span>
                <select
                  :value="settings.editor.tabSize"
                  :aria-label="t('settings.editorTabSize')"
                  aria-describedby="settings-editor-tab-size-hint"
                  @change="
                    setEditor(
                      'tabSize',
                      Number(
                        ($event.target as HTMLSelectElement).value,
                      ) as FulvidSettings['editor']['tabSize'],
                    )
                  "
                >
                  <option value="2">2</option>
                  <option value="4">4</option>
                  <option value="8">8</option>
                </select>
              </label>

              <label class="settings-option" data-settings-id="editor.insertSpaces">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.insertSpaces"
                  aria-describedby="settings-editor-insert-spaces-hint"
                  @change="setEditor('insertSpaces', ($event.target as HTMLInputElement).checked)"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorInsertSpaces") }}</span>
                  <span id="settings-editor-insert-spaces-hint" class="settings-option__hint">
                    {{ t("settings.editorInsertSpacesHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="editor.autoIndent">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.autoIndent"
                  aria-describedby="settings-editor-auto-indent-hint"
                  @change="setEditor('autoIndent', ($event.target as HTMLInputElement).checked)"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorAutoIndent") }}</span>
                  <span id="settings-editor-auto-indent-hint" class="settings-option__hint">
                    {{ t("settings.editorAutoIndentHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="editor.wordWrap">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorWordWrap") }}</span>
                  <span id="settings-editor-word-wrap-hint" class="settings-option__hint">
                    {{ t("settings.editorWordWrapHint") }}
                  </span>
                </span>
                <select
                  :value="settings.editor.wordWrap"
                  :aria-label="t('settings.editorWordWrap')"
                  aria-describedby="settings-editor-word-wrap-hint"
                  @change="
                    setEditor(
                      'wordWrap',
                      ($event.target as HTMLSelectElement)
                        .value as FulvidSettings['editor']['wordWrap'],
                    )
                  "
                >
                  <option value="on">{{ t("settings.editorWordWrapOn") }}</option>
                  <option value="bounded">{{ t("settings.editorWordWrapBounded") }}</option>
                  <option value="off">{{ t("settings.editorWordWrapOff") }}</option>
                </select>
              </label>
            </fieldset>
          </section>

          <section
            v-if="selectedCategory === 'files'"
            class="settings-section"
            aria-labelledby="settings-files"
          >
            <h2 id="settings-files" class="settings-section__title">
              {{ t("settings.files") }}
            </h2>
            <fieldset class="settings-field">
              <legend class="sr-only">{{ t("settings.files") }}</legend>

              <label class="settings-option" data-settings-id="editor.defaultEol">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorDefaultEol") }}</span>
                  <span id="settings-editor-default-eol-hint" class="settings-option__hint">
                    {{ t("settings.editorDefaultEolHint") }}
                  </span>
                </span>
                <select
                  :value="settings.editor.defaultEol"
                  :aria-label="t('settings.editorDefaultEol')"
                  aria-describedby="settings-editor-default-eol-hint"
                  @change="
                    setEditor(
                      'defaultEol',
                      ($event.target as HTMLSelectElement)
                        .value as FulvidSettings['editor']['defaultEol'],
                    )
                  "
                >
                  <option value="lf">{{ t("settings.editorDefaultEolLf") }}</option>
                  <option value="crlf">{{ t("settings.editorDefaultEolCrlf") }}</option>
                </select>
              </label>

              <label class="settings-option" data-settings-id="editor.trimTrailingWhitespaceOnSave">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.trimTrailingWhitespaceOnSave"
                  :aria-label="t('settings.trimTrailingWhitespaceOnSave')"
                  aria-describedby="settings-editor-trim-trailing-hint"
                  @change="
                    setEditor(
                      'trimTrailingWhitespaceOnSave',
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{
                    t("settings.trimTrailingWhitespaceOnSave")
                  }}</span>
                  <span id="settings-editor-trim-trailing-hint" class="settings-option__hint">
                    {{ t("settings.trimTrailingWhitespaceOnSaveHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="markdown.defaultExtension">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.defaultExtension") }}</span>
                  <span id="settings-default-extension-hint" class="settings-option__hint">
                    {{ t("settings.defaultExtensionHint") }}
                  </span>
                </span>
                <select
                  :value="settings.links.defaultExtension"
                  :aria-label="t('settings.defaultExtension')"
                  aria-describedby="settings-default-extension-hint"
                  @change="
                    setLinkPref(
                      'defaultExtension',
                      ($event.target as HTMLSelectElement)
                        .value as FulvidSettings['links']['defaultExtension'],
                    )
                  "
                >
                  <option value="md">.md</option>
                  <option value="markdown">.markdown</option>
                  <option value="mdx">.mdx</option>
                </select>
              </label>
            </fieldset>
          </section>

          <section
            v-if="selectedCategory === 'editorDisplay'"
            class="settings-section"
            aria-labelledby="settings-editorDisplay"
          >
            <h2 id="settings-editorDisplay" class="settings-section__title">
              {{ t("settings.editorDisplay") }}
            </h2>
            <fieldset class="settings-field">
              <legend class="sr-only">{{ t("settings.editorDisplay") }}</legend>

              <label class="settings-option" data-settings-id="editor.lineNumbers">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.lineNumbers"
                  aria-describedby="settings-editor-line-numbers-hint"
                  @change="setEditor('lineNumbers', ($event.target as HTMLInputElement).checked)"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorLineNumbers") }}</span>
                  <span id="settings-editor-line-numbers-hint" class="settings-option__hint">
                    {{ t("settings.editorLineNumbersHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="editor.showSessionChanges">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.showSessionChanges"
                  @change="
                    setEditor('showSessionChanges', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.showSessionChanges") }}</span>
                  <span class="settings-option__hint">
                    {{ t("settings.showSessionChangesHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="editor.showDocumentAnnotations">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.showDocumentAnnotations"
                  @change="
                    setEditor(
                      'showDocumentAnnotations',
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{
                    t("settings.showDocumentAnnotations")
                  }}</span>
                  <span class="settings-option__hint">
                    {{ t("settings.showDocumentAnnotationsHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="editor.minimap">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.minimap"
                  aria-describedby="settings-editor-minimap-hint"
                  @change="setEditor('minimap', ($event.target as HTMLInputElement).checked)"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorMinimap") }}</span>
                  <span id="settings-editor-minimap-hint" class="settings-option__hint">
                    {{ t("settings.editorMinimapHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="editor.stickyScroll">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.stickyScroll"
                  aria-describedby="settings-editor-sticky-scroll-hint"
                  @change="setEditor('stickyScroll', ($event.target as HTMLInputElement).checked)"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorStickyScroll") }}</span>
                  <span id="settings-editor-sticky-scroll-hint" class="settings-option__hint">
                    {{ t("settings.editorStickyScrollHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="editor.whitespace">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.editorWhitespace") }}</span>
                  <span id="settings-editor-whitespace-hint" class="settings-option__hint">
                    {{ t("settings.editorWhitespaceHint") }}
                  </span>
                </span>
                <select
                  :value="settings.editor.renderWhitespace"
                  :aria-label="t('settings.editorWhitespace')"
                  aria-describedby="settings-editor-whitespace-hint"
                  @change="
                    setEditor(
                      'renderWhitespace',
                      ($event.target as HTMLSelectElement)
                        .value as FulvidSettings['editor']['renderWhitespace'],
                    )
                  "
                >
                  <option value="none">{{ t("settings.editorWhitespaceNone") }}</option>
                  <option value="selection">{{ t("settings.editorWhitespaceSelection") }}</option>
                  <option value="all">{{ t("settings.editorWhitespaceAll") }}</option>
                </select>
              </label>
            </fieldset>
          </section>

          <section
            v-if="selectedCategory === 'writing'"
            class="settings-section"
            aria-labelledby="settings-writing"
          >
            <h2 id="settings-writing" class="settings-section__title">
              {{ t("settings.writing") }}
            </h2>
            <fieldset class="settings-field">
              <legend class="sr-only">{{ t("settings.writing") }}</legend>

              <label class="settings-option" data-settings-id="editor.typewriterScrolling">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.typewriterScrolling"
                  aria-describedby="settings-editor-typewriter-hint"
                  @change="
                    setEditor('typewriterScrolling', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.typewriterScrolling") }}</span>
                  <span id="settings-editor-typewriter-hint" class="settings-option__hint">
                    {{ t("settings.typewriterScrollingHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="editor.markdownFormatBar">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.editor.showMarkdownFormatBar"
                  @change="
                    setEditor('showMarkdownFormatBar', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.markdownFormatBar") }}</span>
                  <span class="settings-option__hint">
                    {{ t("settings.markdownFormatBarHint") }}
                  </span>
                </span>
              </label>
            </fieldset>
          </section>

          <section
            v-if="selectedCategory === 'theme'"
            class="settings-section"
            aria-labelledby="settings-theme"
          >
            <h2 id="settings-theme" class="settings-section__title">
              {{ t("settings.themeCategory") }}
            </h2>
            <fieldset
              class="settings-field settings-field--themes"
              data-settings-id="appearance.theme"
            >
              <legend class="settings-field__label">{{ t("settings.theme") }}</legend>
              <p class="settings-field__hint">{{ t("settings.themeHint") }}</p>
              <div
                class="settings-theme-families"
                role="radiogroup"
                :aria-label="t('settings.theme')"
              >
                <section
                  v-for="family in THEME_FAMILIES"
                  :key="family.id"
                  class="settings-theme-family"
                >
                  <h3 class="settings-theme-family__title">{{ t(family.label) }}</h3>
                  <div class="settings-theme-grid">
                    <label
                      v-for="option in themeOptionsForFamily(family.id)"
                      :key="option.id"
                      class="settings-theme-card"
                      :class="{
                        'is-selected': settings.appearance.theme === option.id,
                      }"
                    >
                      <input
                        class="settings-choice-card__input"
                        type="radio"
                        name="theme"
                        :value="option.id"
                        :checked="settings.appearance.theme === option.id"
                        :aria-label="t(option.label)"
                        :aria-describedby="`theme-${option.id}-hint`"
                        @change="setTheme(option.id)"
                      />
                      <div class="settings-theme-preview" aria-hidden="true">
                        <div
                          v-for="previewTheme in option.preview"
                          :key="previewTheme"
                          class="settings-theme-preview__pane"
                          :data-theme="previewTheme"
                        >
                          <div class="settings-theme-preview__chrome">
                            <span class="settings-theme-preview__chrome-brand">Fulvid</span>
                            <span class="settings-theme-preview__chrome-menu"
                              >File&nbsp;&nbsp;Edit</span
                            >
                            <span class="settings-theme-preview__chrome-state"></span>
                          </div>
                          <div class="settings-theme-preview__body">
                            <div class="settings-theme-preview__sidebar">
                              <span class="settings-theme-preview__brand">Folder</span>
                              <span
                                class="settings-theme-preview__sidebar-item settings-theme-preview__sidebar-item--active"
                              >
                                Editor
                              </span>
                              <span class="settings-theme-preview__sidebar-item">Search</span>
                              <span class="settings-theme-preview__sidebar-item">Graph</span>
                            </div>
                            <div class="settings-theme-preview__editor">
                              <div class="settings-theme-preview__tabs">
                                <span class="settings-theme-preview__tab">Untitled.mdx</span>
                              </div>
                              <span
                                class="settings-theme-preview__line settings-theme-preview__line--heading"
                              >
                                <span
                                  class="settings-theme-preview__token settings-theme-preview__token--heading"
                                >
                                  # Heading
                                </span>
                              </span>
                              <span class="settings-theme-preview__line">
                                <span class="settings-theme-preview__token--muted">Text with </span>
                                <span class="settings-theme-preview__token--link">a link</span>
                              </span>
                              <span class="settings-theme-preview__line">
                                <span class="settings-theme-preview__token--code">```md</span>
                              </span>
                              <span
                                class="settings-theme-preview__line settings-theme-preview__line--selected"
                              >
                                <span class="settings-theme-preview__token--code">
                                  - selected line
                                </span>
                              </span>
                            </div>
                          </div>
                          <div class="settings-theme-preview__status">
                            <span>Markdown</span>
                            <span>Saved</span>
                          </div>
                        </div>
                      </div>
                      <span class="settings-theme-card__copy">
                        <span class="settings-theme-card__name-row">
                          <span class="settings-theme-card__name">{{ t(option.label) }}</span>
                          <span
                            v-if="settings.appearance.theme === option.id"
                            class="settings-theme-card__selected"
                            aria-hidden="true"
                          ></span>
                        </span>
                        <span :id="`theme-${option.id}-hint`" class="settings-theme-card__hint">
                          {{ t(option.hint) }}
                        </span>
                      </span>
                    </label>
                  </div>
                </section>
              </div>
            </fieldset>
          </section>

          <section
            v-if="selectedCategory === 'interface'"
            class="settings-section"
            aria-labelledby="settings-interface"
          >
            <h2 id="settings-interface" class="settings-section__title">
              {{ t("settings.interface") }}
            </h2>
            <fieldset class="settings-field settings-field--interface">
              <legend class="settings-field__label">{{ t("settings.interfaceScale") }}</legend>

              <p class="settings-field__hint">{{ t("settings.interfaceScaleHint") }}</p>

              <label class="settings-option" data-settings-id="appearance.interfaceTextSize">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.interfaceTextSize") }}</span>
                  <span id="settings-interface-text-size-hint" class="settings-option__hint">
                    {{ t("settings.interfaceTextSizeHint") }}
                  </span>
                </span>
                <select
                  :value="settings.appearance.interfaceTextScale"
                  :aria-label="t('settings.interfaceTextSize')"
                  aria-describedby="settings-interface-text-size-hint"
                  @change="
                    setAppearance(
                      'interfaceTextScale',
                      ($event.target as HTMLSelectElement)
                        .value as FulvidSettings['appearance']['interfaceTextScale'],
                    )
                  "
                >
                  <option value="small">{{ t("settings.interfaceTextSmall") }}</option>
                  <option value="normal">{{ t("settings.interfaceTextNormal") }}</option>
                  <option value="large">{{ t("settings.interfaceTextLarge") }}</option>
                </select>
              </label>

              <label class="settings-option" data-settings-id="appearance.iconSize">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.interfaceIconSize") }}</span>
                  <span id="settings-interface-icon-size-hint" class="settings-option__hint">
                    {{ t("settings.interfaceIconSizeHint") }}
                  </span>
                </span>
                <select
                  :value="settings.appearance.iconScale"
                  :aria-label="t('settings.interfaceIconSize')"
                  aria-describedby="settings-interface-icon-size-hint"
                  @change="
                    setAppearance(
                      'iconScale',
                      ($event.target as HTMLSelectElement)
                        .value as FulvidSettings['appearance']['iconScale'],
                    )
                  "
                >
                  <option value="small">{{ t("settings.interfaceIconSmall") }}</option>
                  <option value="normal">{{ t("settings.interfaceIconNormal") }}</option>
                  <option value="large">{{ t("settings.interfaceIconLarge") }}</option>
                </select>
              </label>

              <div class="settings-density" data-settings-id="appearance.density">
                <div class="settings-density__copy">
                  <span class="settings-option__name">{{ t("settings.density") }}</span>
                  <span id="settings-density-hint" class="settings-option__hint">
                    {{ t("settings.densityHint") }}
                  </span>
                </div>
                <div
                  class="settings-density__grid"
                  role="radiogroup"
                  :aria-label="t('settings.density')"
                  aria-describedby="settings-density-hint"
                >
                  <label
                    v-for="option in DENSITY_OPTIONS"
                    :key="option.id"
                    class="settings-density-card"
                    :class="{
                      'is-selected': settings.appearance.density === option.id,
                    }"
                  >
                    <input
                      class="settings-choice-card__input"
                      type="radio"
                      name="interface-density"
                      :value="option.id"
                      :checked="settings.appearance.density === option.id"
                      :aria-label="t(option.label)"
                      :aria-describedby="`settings-density-${option.id}-hint`"
                      @change="setAppearance('density', option.id)"
                    />
                    <span
                      class="settings-density-card__preview"
                      :class="{ 'is-compact': option.id === 'compact' }"
                      aria-hidden="true"
                    >
                      <span class="settings-density-card__bar"></span>
                      <span class="settings-density-card__bar"></span>
                      <span class="settings-density-card__bar"></span>
                    </span>
                    <span class="settings-density-card__copy">
                      <span class="settings-density-card__name">{{ t(option.label) }}</span>
                      <span
                        :id="`settings-density-${option.id}-hint`"
                        class="settings-density-card__hint"
                      >
                        {{ t(option.hint) }}
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              <label class="settings-option" data-settings-id="editor.documentLocation">
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.documentLocation") }}</span>
                  <span class="settings-option__hint">{{
                    t("settings.documentLocationHint")
                  }}</span>
                </span>
                <select
                  class="settings-option__control"
                  :value="settings.editor.documentLocation"
                  :aria-label="t('settings.documentLocation')"
                  @change="
                    setEditor(
                      'documentLocation',
                      ($event.target as HTMLSelectElement)
                        .value as FulvidSettings['editor']['documentLocation'],
                    )
                  "
                >
                  <option value="main-panel">{{ t("settings.documentLocationMainPanel") }}</option>
                  <option value="window-title">
                    {{ t("settings.documentLocationWindowTitle") }}
                  </option>
                  <option value="hidden">{{ t("settings.documentLocationHidden") }}</option>
                </select>
              </label>
            </fieldset>
          </section>

          <section
            v-if="selectedCategory === 'accessibility'"
            class="settings-section"
            aria-labelledby="settings-accessibility"
          >
            <h2 id="settings-accessibility" class="settings-section__title">
              {{ t("settings.accessibility") }}
            </h2>
            <label class="settings-option" data-settings-id="accessibility.reducedMotion">
              <input
                class="settings-option__control"
                type="checkbox"
                :checked="settings.appearance.reducedMotion"
                @change="
                  setAppearance('reducedMotion', ($event.target as HTMLInputElement).checked)
                "
              />
              <span class="settings-option__copy">
                <span class="settings-option__name">{{ t("settings.reducedMotion") }}</span>
                <span class="settings-option__hint">
                  {{ t("settings.reducedMotionHint") }}
                </span>
              </span>
            </label>
          </section>

          <section
            v-if="selectedCategory === 'statusbar'"
            class="settings-section"
            aria-labelledby="settings-statusbar"
          >
            <h2 id="settings-statusbar" class="settings-section__title">
              {{ t("settings.statusbar") }}
            </h2>
            <fieldset class="settings-field">
              <legend class="sr-only">{{ t("settings.statusbar") }}</legend>
              <label class="settings-option" data-settings-id="appearance.statusbarEnabled">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.appearance.statusbar.enabled"
                  @change="setStatusbarEnabled(($event.target as HTMLInputElement).checked)"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.statusbarEnabled") }}</span>
                  <span class="settings-option__hint">
                    {{ t("settings.statusbarEnabledHint") }}
                  </span>
                </span>
              </label>
              <label
                v-for="indicator in STATUSBAR_INDICATORS"
                :key="indicator.key"
                class="settings-option"
                :data-settings-id="`appearance.statusbar.${indicator.key}`"
              >
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.appearance.statusbar.indicators[indicator.key]"
                  @change="
                    setStatusbarIndicator(
                      indicator.key,
                      ($event.target as HTMLInputElement).checked,
                    )
                  "
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t(indicator.label) }}</span>
                  <span class="settings-option__hint">{{ t(indicator.hint) }}</span>
                </span>
              </label>
            </fieldset>
            <label class="settings-option" data-settings-id="editor.readingStatistics">
              <span class="settings-option__copy">
                <span class="settings-option__name">{{ t("settings.readingStatistics") }}</span>
                <span id="settings-editor-reading-statistics-hint" class="settings-option__hint">
                  {{ t("settings.readingStatisticsHint") }}
                </span>
              </span>
              <select
                :value="settings.editor.readingStatistics"
                :aria-label="t('settings.readingStatistics')"
                aria-describedby="settings-editor-reading-statistics-hint"
                @change="
                  setEditor(
                    'readingStatistics',
                    ($event.target as HTMLSelectElement)
                      .value as FulvidSettings['editor']['readingStatistics'],
                  )
                "
              >
                <option value="off">{{ t("settings.readingStatisticsOff") }}</option>
                <option value="words">{{ t("settings.readingStatisticsWords") }}</option>
                <option value="wordsAndTime">
                  {{ t("settings.readingStatisticsWordsAndTime") }}
                </option>
              </select>
            </label>
          </section>

          <section
            v-if="selectedCategory === 'folder'"
            class="settings-section"
            aria-labelledby="settings-folder"
          >
            <h2 id="settings-folder" class="settings-section__title">
              {{ t("settings.folder") }}
            </h2>
            <fieldset data-settings-id="workspace.startup" class="settings-field">
              <legend class="settings-field__label">{{ t("settings.workspaceStartup") }}</legend>
              <label class="settings-option">
                <input
                  type="radio"
                  name="workspace-startup"
                  value="none"
                  :checked="settings.workspace.workspaceStartup === 'none'"
                  @change="setWorkspacePref('workspaceStartup', 'none')"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{
                    t("settings.workspaceStartupNone")
                  }}</span>
                  <span class="settings-option__hint">
                    {{ t("settings.workspaceStartupNoneHint") }}
                  </span>
                </span>
              </label>
              <label class="settings-option">
                <input
                  type="radio"
                  name="workspace-startup"
                  value="last"
                  :checked="settings.workspace.workspaceStartup === 'last'"
                  @change="setWorkspacePref('workspaceStartup', 'last')"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{
                    t("settings.workspaceStartupLast")
                  }}</span>
                  <span class="settings-option__hint">
                    {{ t("settings.workspaceStartupLastHint") }}
                  </span>
                </span>
              </label>
            </fieldset>
            <label class="settings-option" data-settings-id="workspace.confirmClose">
              <input
                class="settings-option__control"
                type="checkbox"
                :checked="settings.workspace.confirmClose"
                aria-describedby="settings-confirm-close-hint"
                @change="
                  setWorkspacePref('confirmClose', ($event.target as HTMLInputElement).checked)
                "
              />
              <span class="settings-option__copy">
                <span class="settings-option__name">{{ t("settings.confirmClose") }}</span>
                <span id="settings-confirm-close-hint" class="settings-option__hint">
                  {{ t("settings.confirmCloseHint") }}
                </span>
              </span>
            </label>
            <label class="settings-option" data-settings-id="workspace.showHidden">
              <input
                class="settings-option__control"
                type="checkbox"
                :checked="settings.workspace.showHiddenFiles"
                @change="
                  setWorkspacePref('showHiddenFiles', ($event.target as HTMLInputElement).checked)
                "
              />
              <span class="settings-option__copy">
                <span class="settings-option__name">{{ t("settings.showHidden") }}</span>
                <span class="settings-option__hint">
                  {{ t("settings.showHiddenHint") }}
                </span>
              </span>
            </label>
          </section>

          <section
            v-if="selectedCategory === 'links'"
            class="settings-section"
            aria-labelledby="settings-links"
          >
            <h2 id="settings-links" class="settings-section__title">
              {{ t("settings.links") }}
            </h2>
            <fieldset data-settings-id="markdown.linkMode" class="settings-field">
              <legend class="settings-field__label">{{ t("settings.linkMode") }}</legend>
              <p class="settings-field__hint">{{ t("settings.linkModeHint") }}</p>
              <label class="settings-option">
                <input
                  type="radio"
                  name="link-mode"
                  value="markdown"
                  :checked="settings.links.linkMode === 'markdown'"
                  @change="setLinkMode('markdown')"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.markdownLinks") }}</span>
                  <span class="settings-option__hint">
                    {{ t("settings.markdownLinksHint") }}
                  </span>
                </span>
              </label>
              <label class="settings-option">
                <input
                  type="radio"
                  name="link-mode"
                  value="wikilink"
                  :checked="settings.links.linkMode === 'wikilink'"
                  @change="setLinkMode('wikilink')"
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.wikilinks") }}</span>
                  <span class="settings-option__hint">
                    {{ t("settings.wikilinksHint") }}
                  </span>
                </span>
              </label>
            </fieldset>
            <label class="settings-option" data-settings-id="markdown.resolution">
              <span class="settings-option__copy">
                <span class="settings-option__name">{{ t("settings.resolution") }}</span>
                <span id="settings-resolution-hint" class="settings-option__hint">
                  {{ t("settings.resolutionHint") }}
                </span>
              </span>
              <select
                :value="settings.links.resolution"
                :aria-label="t('settings.resolution')"
                aria-describedby="settings-resolution-hint"
                @change="
                  setLinkPref(
                    'resolution',
                    ($event.target as HTMLSelectElement)
                      .value as FulvidSettings['links']['resolution'],
                  )
                "
              >
                <option value="stem">{{ t("settings.resolutionStem") }}</option>
                <option value="path">{{ t("settings.resolutionPath") }}</option>
                <option value="both">{{ t("settings.resolutionBoth") }}</option>
              </select>
            </label>
          </section>

          <section
            v-if="selectedCategory === 'context'"
            class="settings-section"
            aria-labelledby="settings-context"
          >
            <h2 id="settings-context" class="settings-section__title">
              {{ t("settings.context") }}
            </h2>
            <fieldset class="settings-field">
              <legend class="settings-field__label">{{ t("settings.markdownContext") }}</legend>
              <label class="settings-option" data-settings-id="markdown.showOutgoingLinks">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.links.showOutgoingLinks"
                  aria-describedby="settings-show-outgoing-hint"
                  @change="
                    setLinkPref('showOutgoingLinks', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.showOutgoingLinks") }}</span>
                  <span id="settings-show-outgoing-hint" class="settings-option__hint">
                    {{ t("settings.showOutgoingLinksHint") }}
                  </span>
                </span>
              </label>

              <label class="settings-option" data-settings-id="markdown.showIncomingLinks">
                <input
                  class="settings-option__control"
                  type="checkbox"
                  :checked="settings.links.showIncomingLinks"
                  aria-describedby="settings-show-incoming-hint"
                  @change="
                    setLinkPref('showIncomingLinks', ($event.target as HTMLInputElement).checked)
                  "
                />
                <span class="settings-option__copy">
                  <span class="settings-option__name">{{ t("settings.showIncomingLinks") }}</span>
                  <span id="settings-show-incoming-hint" class="settings-option__hint">
                    {{ t("settings.showIncomingLinksHint") }}
                  </span>
                </span>
              </label>
            </fieldset>
          </section>

          <section
            v-if="selectedCategory === 'preview'"
            class="settings-section"
            aria-labelledby="settings-preview"
          >
            <h2 id="settings-preview" class="settings-section__title">
              {{ t("settings.preview") }}
            </h2>
            <label class="settings-option" data-settings-id="preview.enabled">
              <input
                class="settings-option__control"
                type="checkbox"
                :checked="settings.preview.enabled"
                @change="setPreviewEnabled(($event.target as HTMLInputElement).checked)"
              />
              <span class="settings-option__copy">
                <span class="settings-option__name">{{ t("settings.showPreview") }}</span>
                <span class="settings-option__hint">
                  {{ t("settings.showPreviewHint") }}
                </span>
              </span>
            </label>
          </section>

          <section
            v-if="selectedCategory === 'extensions'"
            class="settings-section"
            aria-labelledby="settings-extensions"
          >
            <h2
              id="settings-extensions"
              class="settings-section__title"
              data-settings-id="extensions.section"
              tabindex="-1"
            >
              {{ t("settings.extensions") }}
            </h2>
            <p class="settings-option__hint" data-settings-id="extensions.intro">
              {{ t("settings.extensionsHint") }}
            </p>
            <div class="settings-extension-toolbar" data-settings-id="extensions.toolbar">
              <button
                type="button"
                class="settings-reset__button"
                :disabled="extensionsBusy"
                @click="installExtensionPack"
              >
                {{ t("settings.extensionInstall") }}
              </button>
              <button
                type="button"
                class="settings-reset__button"
                :disabled="extensionsBusy"
                @click="rediscoverExtensions"
              >
                {{ t("settings.extensionRediscover") }}
              </button>
            </div>
            <p
              v-if="installedExtensions.length === 0"
              class="settings-option__hint"
              data-settings-id="extensions.empty"
            >
              {{ t("settings.extensionsEmpty") }}
            </p>
            <ul v-else class="settings-extension-list" data-settings-id="extensions.list">
              <li
                v-for="pack in installedExtensions"
                :key="pack.id"
                class="settings-extension-card"
                :data-settings-id="`extensions.pack.${pack.id}`"
                :data-state="pack.state"
              >
                <div class="settings-extension-card__header">
                  <div class="settings-extension-card__titles">
                    <h3 class="settings-extension-card__name">{{ pack.displayName }}</h3>
                    <p class="settings-extension-card__identity">
                      <code>{{ pack.id }}</code>
                      <span aria-hidden="true"> - </span>
                      <span>{{ pack.publisher }}</span>
                      <span aria-hidden="true"> - </span>
                      <span>{{ pack.version }}</span>
                    </p>
                  </div>
                  <span class="settings-extension-card__state" :data-state="pack.state">
                    {{ extensionStateLabel(pack.state) }}
                  </span>
                </div>
                <p v-if="pack.description" class="settings-extension-card__description">
                  {{ pack.description }}
                </p>
                <p class="settings-extension-card__meta-line">
                  {{ extensionMetaLine(pack) }}
                </p>
                <p class="settings-extension-card__capabilities">
                  {{
                    pack.capabilities.length > 0
                      ? pack.capabilities.join(", ")
                      : t("settings.extensionCapabilitiesNone")
                  }}
                </p>
                <p v-if="pack.reason" class="settings-extension-card__reason">
                  {{ pack.reason }}
                </p>
                <div class="settings-extension-card__actions">
                  <button
                    type="button"
                    class="settings-reset__button"
                    :disabled="extensionsBusy"
                    @click="openExtensionFolder(pack.id)"
                  >
                    {{ t("settings.extensionOpenFolder") }}
                  </button>
                  <button
                    v-if="pack.state === 'blocked' || pack.state === 'failed'"
                    type="button"
                    class="settings-reset__button"
                    :disabled="extensionsBusy"
                    @click="reviewBlockedExtension(pack.id)"
                  >
                    {{ t("settings.extensionReviewBlocked") }}
                  </button>
                  <button
                    type="button"
                    class="settings-reset__button settings-reset__button--danger"
                    :disabled="extensionsBusy"
                    @click="uninstallExtensionPack(pack.id)"
                  >
                    {{ t("settings.extensionUninstall") }}
                  </button>
                </div>
              </li>
            </ul>
          </section>

          <section
            v-if="selectedCategory === 'keyboard'"
            class="settings-section"
            aria-labelledby="settings-keyboard"
          >
            <h2
              id="settings-keyboard"
              class="settings-section__title"
              data-settings-id="keyboard.section"
              tabindex="-1"
            >
              {{ t("settings.keyboard") }}
            </h2>
            <dl class="settings-shortcuts">
              <div class="settings-shortcuts__row">
                <dt><kbd>1</kbd>-<kbd>3</kbd></dt>
                <dd>{{ t("settings.shortcutsNavigation") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt><kbd>/</kbd></dt>
                <dd>{{ t("settings.shortcutGlobalSearch") }}</dd>
              </div>
              <div
                class="settings-shortcuts__row"
                data-settings-id="keyboard.quickOpen"
                tabindex="-1"
              >
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>P</kbd>
                </dt>
                <dd>{{ t("settings.shortcutQuickOpen") }}</dd>
              </div>
              <div
                class="settings-shortcuts__row"
                data-settings-id="keyboard.globalSearch"
                tabindex="-1"
              >
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>Shift</kbd><kbd>F</kbd>
                </dt>
                <dd>{{ t("settings.shortcutGlobalSearch") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>B</kbd>
                </dt>
                <dd>{{ t("settings.shortcutBold") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>I</kbd>
                </dt>
                <dd>{{ t("settings.shortcutItalic") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>E</kbd>
                </dt>
                <dd>{{ t("settings.shortcutInlineCode") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>K</kbd>
                </dt>
                <dd>{{ t("settings.shortcutLink") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>F</kbd>
                </dt>
                <dd>{{ t("settings.shortcutLocalFind") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>H</kbd>
                </dt>
                <dd>{{ t("settings.shortcutReplace") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>Shift</kbd><kbd>O</kbd>
                </dt>
                <dd>{{ t("settings.shortcutOutline") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>{{ t("menu.navigate") }}</dt>
                <dd>{{ t("settings.shortcutDocumentAnnotations") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>Shift</kbd><kbd>E</kbd>
                </dt>
                <dd>{{ t("settings.shortcutLeftSidebar") }}</dd>
              </div>
              <div
                class="settings-shortcuts__row"
                data-settings-id="keyboard.writingFocus"
                tabindex="-1"
              >
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>Shift</kbd><kbd>Enter</kbd>
                </dt>
                <dd>{{ t("settings.shortcutFocus") }}</dd>
              </div>
              <div
                class="settings-shortcuts__row"
                data-settings-id="keyboard.fullscreen"
                tabindex="-1"
              >
                <dt v-if="isApplePlatform"><kbd>Ctrl</kbd><kbd>Cmd</kbd><kbd>F</kbd></dt>
                <dt v-else><kbd>F11</kbd></dt>
                <dd>{{ t("settings.shortcutFullscreen") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>N</kbd>
                </dt>
                <dd>{{ t("settings.shortcutNew") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>O</kbd>
                </dt>
                <dd>{{ t("settings.shortcutOpenFile") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>S</kbd>
                </dt>
                <dd>{{ t("settings.shortcutSave") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>Shift</kbd><kbd>S</kbd>
                </dt>
                <dd>{{ t("settings.shortcutSaveAs") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>W</kbd>
                </dt>
                <dd>{{ t("settings.shortcutClose") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>Alt</kbd><kbd>W</kbd>
                </dt>
                <dd>{{ t("settings.shortcutCloseOthers") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt><kbd>Left</kbd> <kbd>Right</kbd></dt>
                <dd>{{ t("settings.shortcutTabs") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt><kbd>I</kbd></dt>
                <dd>{{ t("settings.shortcutContext") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt><kbd>G</kbd></dt>
                <dd>{{ t("settings.shortcutGraph") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt><kbd>Esc</kbd></dt>
                <dd>{{ t("settings.shortcutEscape") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt><kbd>Up</kbd> <kbd>Down</kbd> / <kbd>J</kbd> <kbd>K</kbd></dt>
                <dd>{{ t("settings.shortcutMove") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt><kbd>[</kbd> <kbd>]</kbd></dt>
                <dd>{{ t("settings.shortcutDepth") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt><kbd>Enter</kbd></dt>
                <dd>{{ t("settings.shortcutOpen") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt><kbd>C</kbd> / <kbd>+</kbd> <kbd>-</kbd></dt>
                <dd>{{ t("settings.shortcutLocate") }}</dd>
              </div>
            </dl>
          </section>

          <section
            v-if="selectedCategory === 'about'"
            class="settings-section"
            aria-labelledby="settings-about"
          >
            <h2 id="settings-about" class="settings-section__title">
              {{ t("settings.about") }}
            </h2>
            <div class="settings-about" data-settings-id="general.about" tabindex="-1">
              <h3 class="settings-about__heading">{{ t("settings.aboutInformation") }}</h3>
              <div class="settings-about__intro">
                <p class="settings-about__product">{{ t("app.product") }}</p>
                <p class="settings-about__lead">{{ t("settings.aboutDescription") }}</p>
                <p class="settings-about__text">{{ t("settings.aboutPurpose") }}</p>
              </div>

              <div class="settings-about__details">
                <p class="settings-about__text">{{ t("settings.aboutFormatsText") }}</p>
                <p class="settings-about__text">{{ t("settings.aboutBuiltWithText") }}</p>
              </div>

              <dl class="settings-about__metadata">
                <div class="settings-about__item">
                  <dt>{{ t("settings.author") }}</dt>
                  <dd>{{ APP_AUTHOR.name }}</dd>
                </div>
                <div class="settings-about__item">
                  <dt>{{ t("settings.license") }}</dt>
                  <dd>{{ APP_LICENSE }}</dd>
                </div>
                <div class="settings-about__item">
                  <dt>{{ t("settings.version") }}</dt>
                  <dd>{{ APP_VERSION }}</dd>
                </div>
              </dl>

              <div class="settings-about__support">
                <h3 class="settings-about__heading">{{ t("settings.aboutSupport") }}</h3>
                <p class="settings-about__text">{{ t("settings.aboutSupportDescription") }}</p>
                <p class="settings-about__support-action">
                  <a
                    class="settings-about__sponsor"
                    data-settings-id="general.sponsor"
                    :href="APP_SPONSOR.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    @click.prevent="onOpenSponsorPage"
                  >
                    {{ t("settings.sponsor") }}
                  </a>
                  <span id="settings-sponsor-hint" class="settings-option__hint">
                    {{ t("settings.sponsorHint") }}
                  </span>
                </p>
              </div>
            </div>
            <div
              class="settings-reset"
              data-settings-id="general.reset"
              aria-labelledby="settings-reset-heading"
            >
              <div class="settings-reset__copy">
                <h3 id="settings-reset-heading" class="settings-about__heading">
                  {{ t("settings.aboutMaintenance") }}
                </h3>
                <p class="settings-option__name">{{ t("settings.resetToDefaults") }}</p>
                <p id="settings-reset-hint" class="settings-option__hint">
                  {{ t("settings.resetToDefaultsHint") }}
                </p>
              </div>
              <button
                type="button"
                class="settings-reset__button"
                aria-describedby="settings-reset-hint"
                @click="onResetSettings"
              >
                {{ t("settings.resetToDefaultsAction") }}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  </PageShell>
</template>

<style scoped lang="scss">
@use "../../styles/colors" as *;
@use "../../styles/variables" as *;
@use "../../styles/object-layout" as *;
@use "../../styles/controls" as *;
@use "../../styles/page-layout" as *;

.settings-layout {
  display: flex;
  flex-direction: row;
  align-items: stretch;
  align-self: stretch;
  gap: $space-group;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  max-width: 52rem;
  max-height: 100%;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
}

.settings-category-nav {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  gap: $space-compact;
  width: clamp(168px, 28vw, 196px);
  min-width: 0;
  min-height: 0;
  padding-inline-end: $space-compact;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-inline-end: 1px solid $border-subtle;
  scrollbar-gutter: stable;
}

.settings-category-nav__group {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.settings-category-nav__group + .settings-category-nav__group {
  padding-block-start: $space-compact;
  border-block-start: 1px solid $border-subtle;
}

.settings-category-nav__group-label {
  margin: 0 0 2px;
  padding-inline: $space-compact;
  color: $text-muted;
  font-size: $font-micro;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.settings-category-nav__item {
  min-height: calc(#{$control-height-small} - 2px);
  padding: 0 $space-compact;
  border: 0;
  border-radius: $radius;
  background: transparent;
  color: $text-secondary;
  font: inherit;
  font-size: $font-control;
  text-align: start;
  cursor: pointer;

  &:hover {
    background: $surface-hover;
    color: $text-primary;
  }

  &:focus-visible {
    outline: 2px solid $focus-ring;
    outline-offset: -2px;
  }

  &.is-active {
    background: $selection;
    color: $selection-foreground;
    font-weight: 600;
  }
}

.settings-page__content {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: $space-compact;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding-bottom: $space-page;
}

.settings-search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: $space-tight;
  max-width: 40rem;
  padding-block: 0;
  background: $background;
}

.settings-search__field {
  flex: 1 1 12rem;
  min-width: 0;
}

.settings-search__input {
  @include control-field;
  width: 100%;
  min-height: $control-height;
}

.settings-search__clear {
  @include quiet-button;
  min-height: $control-height;
}

.settings-search-panel {
  min-width: 0;
}

.settings-search-empty {
  margin: 0;
  color: $text-secondary;
  font-size: $font-control;
}

.settings-search-results {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(28rem, 60vh);
  overflow: auto;
  border: 1px solid $border-subtle;
  border-radius: $radius;
}

.settings-search-results__item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: $space-compact $space-group;
  cursor: pointer;
  border-block-end: 1px solid $border-subtle;

  &:last-child {
    border-block-end: 0;
  }

  &:hover,
  &.is-selected {
    background: $surface-hover;
  }

  &.is-selected {
    outline: 2px solid $focus-ring;
    outline-offset: -2px;
  }
}

.settings-search-results__category {
  color: $text-secondary;
  font-size: $font-caption;
}

.settings-search-results__label {
  color: $text-primary;
  font-size: $font-control;
  font-weight: 600;
}

.settings-search-results__hint {
  color: $text-secondary;
  font-size: $font-caption;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: $space-compact;
  min-width: 0;
  max-width: 40rem;
}

.settings-page__sections {
  display: flex;
  flex-direction: column;
  gap: $space-group;
}

.settings-section__title {
  margin: 0;
  color: $text-primary;
  font-size: $font-section;
  font-weight: 650;
  letter-spacing: -0.02em;
  scroll-margin-top: $space-page;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: $space-compact 0 0;
  border: 0;
  border-block-start: 1px solid $border-subtle;
  min-width: 0;
}

.settings-field__label {
  margin: 0 0 $space-tight;
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 0;
}

.settings-field__hint {
  max-width: 52rem;
  margin: 0;
  color: $text-muted;
  font-size: $font-label;
  line-height: 1.5;
  white-space: pre-line;
}

.settings-field__options {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

@mixin settings-choice-card($card-radius: $radius) {
  min-width: 0;
  border: 1px solid $border-subtle;
  border-radius: $card-radius;
  background: $surface;
  cursor: pointer;

  &:hover {
    border-color: $border;
    background: $surface-hover;
  }

  &:has(.settings-choice-card__input:focus-visible) {
    outline: 2px solid $focus-ring;
    outline-offset: 2px;
  }

  &.is-selected {
    border-color: $accent;
    box-shadow: 0 0 0 1px $accent;
  }
}

.settings-theme-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $space-block;
}

.settings-theme-families {
  display: flex;
  flex-direction: column;
  gap: $space-5;
}

.settings-theme-family {
  display: flex;
  flex-direction: column;
  gap: $space-compact;
}

.settings-theme-family__title {
  margin: 0;
  color: $text-secondary;
  font-size: $font-label;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.settings-theme-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: $space-compact;
  padding: $space-compact;
  @include settings-choice-card($radius-lg);
}

.settings-choice-card__input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.settings-density {
  display: flex;
  flex-direction: column;
  gap: $space-compact;
  padding: $space-compact;
  border: 1px solid $border-subtle;
  border-radius: $radius;
}

.settings-density__copy {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
}

.settings-density__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $space-block;
}

.settings-density-card {
  position: relative;
  display: grid;
  grid-template-columns: minmax(48px, 0.35fr) minmax(0, 1fr);
  gap: $space-compact;
  align-items: center;
  min-height: 76px;
  padding: $space-compact;
  @include settings-choice-card;
}

.settings-density-card__preview {
  --density-preview-bar-height: 5px;
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  padding: $space-related;
  border: 1px solid $border-subtle;
  border-radius: $radius;
  background: $surface-elevated;

  &.is-compact {
    gap: 2px;
    --density-preview-bar-height: 4px;
  }
}

.settings-density-card__bar {
  display: block;
  height: var(--density-preview-bar-height);
  border-radius: 999px;
  background: $text-muted;

  &:nth-child(2) {
    width: 78%;
  }

  &:nth-child(3) {
    width: 58%;
  }
}

.settings-density-card__copy {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  min-width: 0;
}

.settings-density-card__name {
  color: $text-primary;
  font-size: $font-control;
  font-weight: 600;
}

.settings-density-card__hint {
  color: $text-muted;
  font-size: $font-caption;
  line-height: 1.45;
}

.settings-theme-preview {
  display: flex;
  min-height: 112px;
  overflow: hidden;
  border: 1px solid $border-subtle;
  border-radius: $radius;
  background: $surface-elevated;
  font-family: $font-mono;
  font-size: $font-micro;
  line-height: 1.5;
}

.settings-theme-preview__pane {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  background: var(--background);
  color: var(--text-primary);
}

.settings-theme-preview__pane + .settings-theme-preview__pane {
  border-inline-start: 1px solid var(--border);
}

.settings-theme-preview__chrome {
  display: flex;
  align-items: center;
  gap: $space-related;
  min-height: 16px;
  padding: 0 $space-related;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  white-space: nowrap;
}

.settings-theme-preview__chrome-brand {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 700;
  text-overflow: ellipsis;
}

.settings-theme-preview__chrome-menu {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.settings-theme-preview__chrome-state {
  flex: 0 0 5px;
  width: 5px;
  height: 5px;
  margin-inline-start: auto;
  border-radius: 50%;
  background: var(--text-link);
}

.settings-theme-preview__body {
  display: grid;
  grid-template-columns: minmax(28px, 0.34fr) minmax(0, 1fr);
  flex: 1 1 0;
  min-height: 0;
}

.settings-theme-preview__sidebar {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  min-width: 0;
  padding: $space-related;
  overflow: hidden;
  border-inline-end: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
}

.settings-theme-preview__brand {
  overflow: hidden;
  color: var(--text-primary);
  font-size: $font-micro;
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.settings-theme-preview__sidebar-item {
  display: block;
  overflow: hidden;
  padding: 1px 2px;
  border-radius: 2px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.settings-theme-preview__sidebar-item--active {
  background: var(--selection);
  color: var(--selection-foreground);
}

.settings-theme-preview__editor {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  padding: $space-compact;
  overflow: hidden;
}

.settings-theme-preview__tabs {
  display: flex;
  min-width: 0;
  border-bottom: 1px solid var(--border);
}

.settings-theme-preview__tab {
  overflow: hidden;
  padding: 1px $space-tight;
  border-bottom: 2px solid var(--text-link);
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-theme-preview__line {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.settings-theme-preview__line--heading {
  background: var(--surface-hover);
}

.settings-theme-preview__line--selected {
  margin-inline: -$space-related;
  padding-inline: $space-related;
  background: var(--selection);
  color: var(--selection-foreground);
}

.settings-theme-preview__token--heading {
  color: var(--text-heading);
  font-weight: 700;
}

.settings-theme-preview__token--muted {
  color: var(--text-muted);
}

.settings-theme-preview__token--link {
  color: var(--text-link);
  text-decoration: underline;
}

.settings-theme-preview__token--code {
  color: var(--text-code);
}

.settings-theme-preview__status {
  display: flex;
  justify-content: space-between;
  gap: $space-related;
  min-height: $font-control;
  padding: 0 $space-related;
  border-top: 1px solid var(--border);
  color: var(--text-muted);
}

.settings-theme-preview__status > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-theme-card__copy {
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  min-width: 0;
}

.settings-theme-card__name-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-related;
  min-width: 0;
}

.settings-theme-card__name {
  min-width: 0;
  overflow: hidden;
  color: $text-primary;
  font-size: $font-control;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-theme-card__hint {
  color: $text-muted;
  font-size: $font-caption;
  line-height: 1.45;
}

.settings-theme-card__selected {
  flex: 0 0 auto;
  display: inline-block;
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: $accent;
}

.settings-option {
  display: flex;
  align-items: flex-start;
  align-self: start;
  gap: $space-compact;
  width: fit-content;
  max-width: 100%;
  min-height: $settings-option-height;
  padding: $space-compact;
  border: 1px solid transparent;
  border-radius: $radius;
  font-size: $font-control;
  cursor: pointer;

  &:hover {
    background: $surface-hover;
  }
}

.settings-option:has(input[type="checkbox"]),
.settings-option:has(input[type="radio"]) {
  align-self: stretch;
  width: 100%;
  max-width: 40rem;
}

.settings-reset {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: $space-compact;
  margin-top: 0;
  padding: $space-block 0 0;
  border: 0;
  border-block-start: 1px solid $border-subtle;
  border-radius: 0;
  max-width: 40rem;
}

.settings-reset__copy {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: $space-tight;
}

.settings-reset__button {
  @include quiet-button;
  flex: 0 0 auto;
  margin-block-start: $space-tight;
  margin-inline-start: 0;
  white-space: nowrap;
}

.settings-option__control {
  @include control-checkbox;
  margin-top: 2px;
}

.settings-option__number {
  @include control-field;
  align-self: center;
  width: 4.5rem;
  margin-inline-start: $space-block;
}

.settings-option select {
  @include control-select;
  flex: 0 0 auto;
  align-self: center;
  width: min(12rem, 42%);
  min-width: 7.5rem;
  margin-inline-start: $space-block;
}

// All boolean radios/checkboxes in option rows share control-checkbox,
// including rows that omit settings-option__control by mistake.
.settings-option input[type="checkbox"],
.settings-option input[type="radio"] {
  @include control-checkbox;
  margin-top: 2px;
}

:global(html[data-theme^="high-contrast"]) .settings-option:has(input:checked) {
  border-color: $border;
  background: $selection;
  color: $selection-foreground;
}

:global(html[data-theme^="high-contrast"])
  .settings-option:has(input:checked)
  .settings-option__hint {
  color: $selection-foreground;
}

:global(html[data-theme^="high-contrast"])
  .settings-option:has(input:checked)
  .settings-option__name {
  color: $selection-foreground;
}

.settings-option__copy {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  gap: $space-tight;
  min-width: 0;
  max-width: 22rem;
}

.settings-option__name {
  color: $text-primary;
  font-weight: 500;
}

.settings-option__hint {
  color: $text-muted;
  font-size: $font-caption;
  line-height: 1.45;
  white-space: pre-line;
}

.settings-about {
  display: flex;
  flex-direction: column;
  gap: $space-related;
  margin: 0;
  max-width: 40rem;
}

.settings-about__heading {
  margin: 0;
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.settings-about__intro,
.settings-about__details {
  display: flex;
  flex-direction: column;
  gap: $space-compact;
}

.settings-about__product {
  margin: 0;
  color: $text-primary;
  font-size: $font-title;
  font-weight: 600;
  line-height: 1.2;
}

.settings-about__lead,
.settings-about__text {
  margin: 0;
  color: $text-secondary;
  font-size: $font-body;
  line-height: 1.5;
}

.settings-about__lead {
  color: $text-primary;
  font-size: $font-lead;
  font-weight: 600;
}

.settings-about__metadata {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  column-gap: $space-group;
  row-gap: $space-compact;
  margin: 0;
  padding-block-start: $space-block;
  border-block-start: 1px solid $border-subtle;
}

.settings-about__item {
  @include object-metric-item;
}

.settings-about__support {
  display: flex;
  flex-direction: column;
  gap: $space-compact;
  margin: 0;
  padding-block-start: $space-block;
  border-block-start: 1px solid $border-subtle;
}

.settings-about__support-action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  margin: 0;
}

.settings-about__sponsor {
  color: $text-link;
  font-size: $font-body;
  line-height: 1.5;
  text-decoration: underline;
  text-underline-offset: 0.15em;
}

.settings-about__sponsor:focus-visible {
  outline: 2px solid $accent;
  outline-offset: 2px;
  border-radius: $radius;
}

.settings-extension-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: $space-tight;
  margin-block: $space-compact $space-group;
}

.settings-extension-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: $space-group;
}

.settings-extension-card {
  padding: $space-group;
  border: 1px solid $border-subtle;
  border-radius: $radius;
  background: color-mix(in srgb, $surface 78%, transparent);
}

.settings-extension-card__header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: $space-tight;
  margin-bottom: $space-compact;
}

.settings-extension-card__titles {
  min-width: 0;
  flex: 1;
}

.settings-extension-card__name {
  margin: 0;
  font-size: $font-control;
  font-weight: 600;
}

.settings-extension-card__identity {
  margin: $space-tight 0 0;
  font-size: $font-label;
  color: $text-muted;
  word-break: break-word;
}

.settings-extension-card__description,
.settings-extension-card__meta-line,
.settings-extension-card__capabilities,
.settings-extension-card__reason {
  margin: 0 0 $space-compact;
  font-size: $font-label;
  color: $text-secondary;
}

.settings-extension-card__reason {
  color: $error-text;
}

.settings-extension-card__state {
  font-size: $font-label;
  font-weight: 600;
  color: $text-secondary;
}

.settings-extension-card__state[data-state="loaded"],
.settings-extension-card__state[data-state="allowed"] {
  color: $success-text;
}

.settings-extension-card__state[data-state="blocked"],
.settings-extension-card__state[data-state="failed"] {
  color: $error-text;
}

.settings-extension-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: $space-tight;
}

.settings-reset__button--danger {
  color: $error-text;
}

.settings-shortcuts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: $space-group;
  row-gap: 0;
  margin: 0;
  max-width: 48rem;
}

.settings-shortcuts__row {
  display: grid;
  grid-template-columns: minmax(5.5rem, auto) minmax(0, 1fr);
  gap: $space-related;
  align-items: baseline;
  min-height: 0;
  padding: $space-related 0;
  border: 0;
  border-block-end: 1px solid $border-subtle;
  border-radius: 0;
  background: transparent;

  dt {
    margin: 0;
    color: $text-primary;
    font-size: $font-control;
  }

  dd {
    margin: 0;
    color: $text-secondary;
    font-size: $font-label;
    line-height: 1.4;
  }

  kbd {
    @include kbd-hint;
  }
}

@media (max-width: 760px) {
  .settings-layout {
    gap: $space-block;
    max-width: none;
  }

  .settings-category-nav {
    width: 156px;
    padding-inline-end: $space-compact;
  }

  .settings-category-nav__item {
    padding-inline: $space-related;
    font-size: $font-label;
  }

  .settings-section {
    max-width: none;
  }

  .settings-about__metadata {
    grid-template-columns: minmax(0, 1fr);
  }

  .settings-shortcuts {
    grid-template-columns: minmax(0, 1fr);
    max-width: none;
  }
}

@media (max-width: 700px) {
  .settings-theme-grid,
  .settings-density__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 520px) {
  .settings-layout {
    display: flex;
    flex-direction: column;
    gap: $space-block;
  }

  .settings-category-nav {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    flex: 0 1 auto;
    max-height: min(42vh, 18rem);
    border-inline-end: 0;
    border-block-end: 1px solid $border-subtle;
    padding: 0 0 $space-related;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .settings-category-nav__group {
    display: contents;
  }

  .settings-category-nav__group + .settings-category-nav__group {
    padding-block-start: 0;
    border-block-start: 0;
  }

  .settings-category-nav__group-label {
    grid-column: 1 / -1;
    margin-block-start: $space-related;
  }

  .settings-category-nav__item {
    min-height: $control-height-small;
  }

  .settings-page__content {
    flex: 1 1 auto;
  }

  .settings-option {
    align-items: flex-start;
  }

  .settings-option select {
    min-width: 0;
  }
}

@media (forced-colors: active) {
  .settings-theme-card,
  .settings-density-card {
    border-color: CanvasText;
    background: Canvas;
    color: CanvasText;

    &:hover,
    &.is-selected {
      border-color: Highlight;
      box-shadow: 0 0 0 1px Highlight;
    }

    &:has(.settings-choice-card__input:focus-visible) {
      outline-color: Highlight;
    }
  }

  .settings-theme-card:hover,
  .settings-density-card:hover,
  .settings-option:hover {
    border-color: Highlight;
    background: Highlight !important;
    color: HighlightText;
  }

  .settings-theme-card:hover .settings-theme-card__name,
  .settings-theme-card:hover .settings-theme-card__hint,
  .settings-density-card:hover .settings-density-card__name,
  .settings-density-card:hover .settings-density-card__hint,
  .settings-option:hover .settings-option__name,
  .settings-option:hover .settings-option__hint {
    color: HighlightText !important;
  }

  .settings-option:has(input:checked) {
    border-color: Highlight;
    background: Highlight;
    color: HighlightText;
  }

  .settings-option:has(input:checked) .settings-option__hint,
  .settings-option:has(input:checked) .settings-option__name {
    color: HighlightText;
  }

  .settings-theme-preview,
  .settings-theme-preview__pane {
    border-color: CanvasText;
    background: Canvas !important;
    color: CanvasText !important;
  }

  .settings-theme-preview__sidebar,
  .settings-theme-preview__editor,
  .settings-theme-preview__chrome,
  .settings-theme-preview__status {
    border-color: CanvasText;
    background: Canvas !important;
    color: CanvasText !important;
  }

  .settings-theme-preview__chrome-brand,
  .settings-theme-preview__tab,
  .settings-theme-preview__status {
    color: CanvasText !important;
  }

  .settings-theme-preview__chrome-state {
    background: LinkText !important;
  }

  .settings-theme-preview__line--heading {
    background: Canvas !important;
  }

  .settings-theme-preview__line--selected {
    background: Highlight !important;
    color: HighlightText !important;
  }

  .settings-theme-preview__token--heading,
  .settings-theme-preview__token--muted,
  .settings-theme-preview__token--code {
    color: CanvasText !important;
  }

  .settings-theme-preview__token--link {
    color: LinkText !important;
  }

  .settings-density {
    border-color: CanvasText;
    background: Canvas;
    color: CanvasText;
  }

  .settings-theme-card__selected {
    background: Highlight;
  }

  .settings-theme-card__name,
  .settings-theme-card__hint,
  .settings-density-card__name,
  .settings-density-card__hint {
    color: CanvasText;
  }

  .settings-density-card__preview {
    border-color: CanvasText;
    background: Canvas;
  }

  .settings-density-card__bar {
    background: CanvasText;
  }

  .settings-density-card__name,
  .settings-density-card__hint {
    color: CanvasText;
  }
}
</style>
