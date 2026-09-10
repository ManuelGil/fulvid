<script setup lang="ts">
/**
 * Single Settings surface. Categories are in-page sections (`#settings-{id}`),
 * not routes or separate stores. Keep the form here so `patchSettings` remains
 * the only write path.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import PageShell from "../../shell/PageShell.vue";
import { patchSettings, settings } from "../../modules/settings/settingsStore";
import type { FulvidSettings, StatusbarIndicator } from "../../modules/settings/settingsStore";
import {
  THEME_FAMILIES,
  themeOptionsForFamily,
  type ThemeOption,
} from "../../modules/editor/monaco/monacoThemes";
import {
  author as APP_AUTHOR,
  license as APP_LICENSE,
  version as APP_VERSION,
} from "../../../../package.json";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

type SettingsCategory =
  | "general"
  | "editor"
  | "appearance"
  | "markdown"
  | "preview"
  | "workspace"
  | "accessibility"
  | "keyboard";

const SETTINGS_CATEGORIES: readonly {
  id: SettingsCategory;
  label: string;
}[] = [
  { id: "general", label: "settings.general" },
  { id: "editor", label: "settings.editor" },
  { id: "appearance", label: "settings.appearance" },
  { id: "markdown", label: "settings.markdown" },
  { id: "preview", label: "settings.preview" },
  { id: "workspace", label: "settings.workspace" },
  { id: "accessibility", label: "settings.accessibility" },
  { id: "keyboard", label: "settings.keyboard" },
];

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
function categoryFromRoute(value: unknown): SettingsCategory {
  return SETTINGS_CATEGORIES.some((category) => category.id === value)
    ? (value as SettingsCategory)
    : "general";
}

const selectedCategory = ref<SettingsCategory>(categoryFromRoute(route.query.section));
const compactCategoryNav = ref(false);
let compactCategoryNavMedia: MediaQueryList | null = null;

const categoryTabOrientation = computed(() =>
  compactCategoryNav.value ? "horizontal" : "vertical",
);

watch(
  () => route.query.section,
  (section) => {
    selectedCategory.value = categoryFromRoute(section);
  },
);

function selectCategory(category: SettingsCategory): void {
  selectedCategory.value = category;
  void router.replace({
    query: {
      ...route.query,
      section: category,
    },
  });
}

function onCategoryKeydown(event: KeyboardEvent, index: number): void {
  const compact = compactCategoryNav.value;
  const delta = compact
    ? event.key === "ArrowRight" || event.key === "ArrowDown"
      ? event.key === "ArrowDown"
        ? 2
        : 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? event.key === "ArrowUp"
          ? -2
          : -1
        : 0
    : event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowUp"
        ? -1
        : 0;
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
    document.querySelector<HTMLElement>(`[data-settings-category="${nextCategory.id}"]`)?.focus();
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

const primaryModifier = computed(() =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl",
);

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
</script>

<template>
  <PageShell :title="t('settings.title')" wide>
    <div class="settings-layout">
      <nav
        class="settings-category-nav"
        role="tablist"
        :aria-orientation="categoryTabOrientation"
        :aria-label="t('settings.title')"
      >
        <button
          v-for="(category, index) in SETTINGS_CATEGORIES"
          :id="`settings-category-${category.id}`"
          :key="category.id"
          type="button"
          role="tab"
          :data-settings-category="category.id"
          class="settings-category-nav__item"
          :class="{ 'is-active': selectedCategory === category.id }"
          :aria-selected="selectedCategory === category.id"
          :aria-controls="'settings-panel'"
          :tabindex="selectedCategory === category.id ? 0 : -1"
          @click="selectCategory(category.id)"
          @keydown="onCategoryKeydown($event, index)"
        >
          {{ t(category.label) }}
        </button>
      </nav>

      <div class="settings-page__content">
        <div
          id="settings-panel"
          class="settings-page__sections"
          role="tabpanel"
          tabindex="-1"
          :aria-labelledby="`settings-category-${selectedCategory}`"
        >
          <section
            v-if="selectedCategory === 'general'"
            class="settings-section"
            aria-labelledby="settings-general"
          >
            <h2 id="settings-general" class="settings-section__title">
              {{ t("settings.general") }}
            </h2>
            <label class="settings-option">
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
                <option value="en">{{ t("settings.english") }}</option>
                <option value="es">{{ t("settings.spanish") }}</option>
              </select>
            </label>
          </section>

          <section
            v-if="selectedCategory === 'editor'"
            class="settings-section"
            aria-labelledby="settings-editor"
          >
            <h2 id="settings-editor" class="settings-section__title">
              {{ t("settings.editor") }}
            </h2>

            <fieldset class="settings-field">
              <legend class="settings-field__label">{{ t("settings.editorTypography") }}</legend>
              <label class="settings-option">
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

              <label class="settings-option">
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

              <label class="settings-option">
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

            <fieldset class="settings-field">
              <legend class="settings-field__label">{{ t("settings.editorEditing") }}</legend>
              <label class="settings-option">
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

              <label class="settings-option">
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

              <label class="settings-option">
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

              <label class="settings-option">
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

            <fieldset class="settings-field">
              <legend class="settings-field__label">{{ t("settings.editorDisplay") }}</legend>
              <label class="settings-option">
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

              <label class="settings-option">
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

              <label class="settings-option">
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

              <label class="settings-option">
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

            <label class="settings-option">
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

            <label class="settings-option">
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

            <label class="settings-option">
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
          </section>

          <section
            v-if="selectedCategory === 'appearance'"
            class="settings-section"
            aria-labelledby="settings-appearance"
          >
            <h2 id="settings-appearance" class="settings-section__title">
              {{ t("settings.appearance") }}
            </h2>

            <fieldset class="settings-field settings-field--themes">
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
                              <span class="settings-theme-preview__brand">Workspace</span>
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
                          >
                            ✓
                          </span>
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

            <fieldset class="settings-field settings-field--interface">
              <legend class="settings-field__label">{{ t("settings.interfaceScale") }}</legend>
              <p class="settings-field__hint">{{ t("settings.interfaceScaleHint") }}</p>

              <label class="settings-option">
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

              <label class="settings-option">
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

              <div class="settings-density">
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
            </fieldset>

            <fieldset class="settings-field">
              <legend class="settings-field__label">{{ t("settings.statusbar") }}</legend>
              <label class="settings-option">
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
          </section>

          <section
            v-if="selectedCategory === 'workspace'"
            class="settings-section"
            aria-labelledby="settings-workspace"
          >
            <h2 id="settings-workspace" class="settings-section__title">
              {{ t("settings.workspace") }}
            </h2>

            <label class="settings-option">
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

            <label class="settings-option">
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

            <fieldset class="settings-field">
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
          </section>

          <section
            v-if="selectedCategory === 'accessibility'"
            class="settings-section"
            aria-labelledby="settings-accessibility"
          >
            <h2 id="settings-accessibility" class="settings-section__title">
              {{ t("settings.accessibility") }}
            </h2>

            <label class="settings-option">
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
            v-if="selectedCategory === 'markdown'"
            class="settings-section"
            aria-labelledby="settings-markdown"
          >
            <h2 id="settings-markdown" class="settings-section__title">
              {{ t("settings.markdown") }}
            </h2>

            <fieldset class="settings-field">
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

            <label class="settings-option">
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

            <label class="settings-option">
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

            <label class="settings-option">
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

            <label class="settings-option">
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
          </section>

          <section
            v-if="selectedCategory === 'preview'"
            class="settings-section"
            aria-labelledby="settings-preview"
          >
            <h2 id="settings-preview" class="settings-section__title">
              {{ t("settings.preview") }}
            </h2>

            <label class="settings-option">
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
            v-if="selectedCategory === 'keyboard'"
            class="settings-section"
            aria-labelledby="settings-keyboard"
          >
            <h2 id="settings-keyboard" class="settings-section__title">
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
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>P</kbd>
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
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>Shift</kbd><kbd>E</kbd>
                </dt>
                <dd>{{ t("settings.shortcutLeftSidebar") }}</dd>
              </div>
              <div class="settings-shortcuts__row">
                <dt>
                  <kbd>{{ primaryModifier }}</kbd
                  ><kbd>Shift</kbd><kbd>F</kbd>
                </dt>
                <dd>{{ t("settings.shortcutFocus") }}</dd>
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
                <dt><kbd>←</kbd> <kbd>→</kbd></dt>
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
                <dt><kbd>↑</kbd> <kbd>↓</kbd> / <kbd>J</kbd> <kbd>K</kbd></dt>
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
            v-if="selectedCategory === 'general'"
            class="settings-section"
            aria-labelledby="settings-about"
          >
            <h2 id="settings-about" class="settings-section__title">
              {{ t("settings.about") }}
            </h2>

            <div class="settings-about">
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
  display: grid;
  grid-template-columns: minmax(152px, 176px) minmax(0, 1fr);
  gap: $space-group;
  align-items: start;
  width: 100%;
  max-width: 1040px;
  padding-bottom: $space-page;
}

.settings-category-nav {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: $space-tight;
  padding-inline-end: $space-group;
  border-inline-end: 1px solid $border-subtle;
}

.settings-category-nav__item {
  min-height: $control-height;
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
  min-width: 0;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: $space-block;
  min-width: 0;
}

.settings-page__sections {
  display: flex;
  flex-direction: column;
  gap: $space-group;
}

.settings-section__title {
  margin: 0 0 $space-related;
  color: $text-primary;
  font-size: $font-section;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: $space-related;
  margin: 0;
  padding: 0;
  border: none;
  min-width: 0;
}

.settings-field__label {
  margin: $space-compact 0 0;
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 600;
  letter-spacing: 0.06em;
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
  min-height: 13px;
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
  color: $accent;
  font-size: $font-control;
  font-weight: 700;
  line-height: 1;
}

.settings-option {
  display: flex;
  align-items: center;
  gap: $space-compact;
  min-height: $settings-option-height;
  padding: $space-compact;
  border: 1px solid transparent;
  border-radius: $radius;
  font-size: $font-control;
  cursor: pointer;

  &:hover {
    background: $surface-hover;
  }

  &:has(input:checked) {
    border-color: $border-subtle;
    background: color-mix(in srgb, $selection 34%, transparent);
  }
}

.settings-option__control {
  @include control-checkbox;
  margin-top: 2px;
}

.settings-option__number {
  @include control-field;
  width: 4.5rem;
  margin-inline-start: auto;
}

.settings-option select {
  @include control-select;
  flex: 0 0 auto;
  width: min(14rem, 48%);
  min-width: 8rem;
  margin-inline-start: auto;
}

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
  flex: 1;
  flex-direction: column;
  gap: $space-tight;
  min-width: 0;
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
  gap: $space-group;
  margin: 0;
}

.settings-about__intro,
.settings-about__details {
  display: flex;
  flex-direction: column;
  gap: $space-related;
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
  display: flex;
  flex-direction: column;
  gap: $space-related;
  margin: 0;
  padding-block-start: $space-group;
  border-block-start: 1px solid $border-subtle;
}

.settings-about__item {
  @include object-metric-item;
}

.settings-shortcuts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: $space-related;
  margin: 0;
  max-width: none;
}

.settings-shortcuts__row {
  display: grid;
  grid-template-columns: minmax(6.5rem, auto) minmax(0, 1fr);
  gap: $space-related;
  align-items: baseline;
  min-height: $settings-option-height;
  padding: $space-compact;
  border: 1px solid $border-subtle;
  border-radius: $radius;
  background: color-mix(in srgb, $surface 78%, transparent);

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
    grid-template-columns: 144px minmax(0, 1fr);
    gap: $space-block;
  }

  .settings-category-nav {
    padding-inline-end: $space-related;
  }

  .settings-category-nav__item {
    padding-inline: $space-related;
    font-size: $font-label;
  }

  .settings-shortcuts {
    grid-template-columns: minmax(0, 1fr);
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
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border-inline-end: 0;
    border-block-end: 1px solid $border-subtle;
    padding: 0 0 $space-related;
  }

  .settings-category-nav__item {
    min-height: $control-height-small;
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
    color: Highlight;
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
