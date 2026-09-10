<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import * as monaco from "monaco-editor/editor";
import "monaco-editor/features/register.all";
import { installMonacoLucideIcons } from "./monacoLucideIcons";

/**
 * Standalone Monaco does not load editor contributions automatically. Register
 * the supported feature entry point once; Fulvid's document and workspace
 * actions stay in the page and shell layers below.
 */
import {
  applyTextEdits,
  formatMarkdown,
  MARKDOWN_COMMANDS,
  offsetToPosition,
  type MarkdownFormatAction,
} from "../markdown/markdownFormat";
import { markdownEnterAction } from "../markdown/markdownEnter";
import { parseMarkdownStructure } from "../markdown/markdownStructure";
import type { EditorCommandState } from "../editorCommandState";

import { settings, type EditorSettings } from "../../settings/settingsStore";
import { monacoEditorPreferences } from "../preferences/editorPreferences";
import { writingFocusActive, writingFocusMonacoOptions } from "../writingFocus";
import {
  applyMonacoTheme,
  currentMonacoTheme,
  initializeMonaco,
  languageForPath,
} from "./monacoSetup";
import {
  ensureDocumentLanguageProviders,
  registerDocumentLanguage,
  registerFrontmatterDiagnostics,
} from "./documentLanguage";

installMonacoLucideIcons();

const props = defineProps<{
  model: monaco.editor.ITextModel;
  path: string;
  rootPath: string | null;
  editorSettings: EditorSettings;
}>();
const { t, locale } = useI18n();

const emit = defineEmits<{
  save: [];
  saveAs: [];
  outline: [];
  escape: [];
  scroll: [ratio: number];
  commandState: [state: EditorCommandState];
}>();

const hostRef = ref<HTMLDivElement | null>(null);
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let resizeObserver: ResizeObserver | null = null;
let stopThemeWatch: (() => void) | null = null;
let stopEditorKeyWatch: monaco.IDisposable | null = null;
let stopScrollWatch: monaco.IDisposable | null = null;
let stopContentWatch: monaco.IDisposable | null = null;
let languageRegistration: monaco.IDisposable | null = null;
let frontmatterRegistration: monaco.IDisposable | null = null;
let colorScheme: MediaQueryList | null = null;
let queuedRevealPosition: { lineNumber: number; column: number } | null = null;
let markdownActions: monaco.IDisposable[] = [];
let stopLocaleWatch: (() => void) | null = null;

function updateLayout(): void {
  editor?.layout();
}

function emitScrollRatio(): void {
  if (!editor) {
    return;
  }
  const layoutInfo = editor.getLayoutInfo();
  const scrollable = Math.max(editor.getScrollHeight() - layoutInfo.height, 0);
  emit("scroll", scrollable > 0 ? editor.getScrollTop() / scrollable : 0);
}

function emitCommandState(): void {
  const model = editor?.getModel();
  emit("commandState", {
    canUndo: Boolean(model?.canUndo()),
    canRedo: Boolean(model?.canRedo()),
  });
}

function queueCommandState(): void {
  queueMicrotask(emitCommandState);
}

function onMarkdownPaste(event: ClipboardEvent): void {
  if (!editor || settings.value.links.linkMode !== "markdown") {
    return;
  }
  const url = event.clipboardData?.getData("text/plain")?.trim() ?? "";
  if (!/^(?:https?:|mailto:)/i.test(url)) {
    return;
  }
  const model = editor.getModel();
  const selection = editor.getSelection();
  if (!model || !selection || selection.isEmpty()) {
    return;
  }
  const selectedText = model.getValueInRange(selection);
  if (!selectedText) {
    return;
  }

  event.preventDefault();
  const target = url.includes(")") ? `<${url}>` : url;
  editor.executeEdits("fulvid-markdown-paste-url", [
    {
      range: selection,
      text: `[${selectedText}](${target})`,
      forceMoveMarkers: true,
    },
  ]);
}

function applyConfiguredMonacoTheme(): void {
  applyMonacoTheme(settings.value.appearance.theme);
}

function applyEditorChrome(): void {
  if (!editor) {
    return;
  }
  const preferences = monacoEditorPreferences(props.editorSettings);
  if (!writingFocusActive.value) {
    editor.updateOptions({
      ...preferences,
      scrollBeyondLastLine: false,
      cursorSurroundingLines: 0,
      padding: { top: 18, bottom: 18 },
    });
    return;
  }
  editor.updateOptions({
    ...preferences,
    ...writingFocusMonacoOptions(
      settings.value.appearance.reducedMotion,
      settings.value.editor.typewriterScrolling,
    ),
  });
}

function onColorSchemeChange(): void {
  applyConfiguredMonacoTheme();
}

function isSuggestWidgetOpen(): boolean {
  return Boolean(editor?.getDomNode()?.querySelector(".suggest-widget.visible"));
}

function handleMarkdownEnter(): boolean {
  if (!editor || isSuggestWidgetOpen()) {
    return false;
  }

  const model = editor.getModel();
  const selections = editor.getSelections();
  if (!model || !selections || selections.length !== 1) {
    return false;
  }

  const selection = selections[0];
  if (!selection || !selection.isEmpty()) {
    return false;
  }

  const position = selection.getPosition();
  const action = markdownEnterAction({
    lines: model.getLinesContent(),
    lineNumber: position.lineNumber,
    column: position.column,
    fences: parseMarkdownStructure(model.getValue()).fences,
  });
  if (!action) {
    return false;
  }

  if (action.kind === "clear-line") {
    editor.executeEdits("fulvid-markdown-exit-prefix", [
      {
        range: new monaco.Range(
          position.lineNumber,
          1,
          position.lineNumber,
          model.getLineMaxColumn(position.lineNumber),
        ),
        text: "",
        forceMoveMarkers: true,
      },
    ]);
    editor.setPosition({ lineNumber: position.lineNumber, column: action.cursorColumn });
    return true;
  }

  editor.executeEdits("fulvid-markdown-enter", [
    {
      range: monaco.Range.fromPositions(position, position),
      text: action.text,
      forceMoveMarkers: true,
    },
  ]);
  editor.setPosition({
    lineNumber: position.lineNumber + action.cursorLineDelta,
    column: action.cursorColumn,
  });
  return true;
}

function mountEditor(): void {
  if (!hostRef.value) {
    return;
  }

  const api = initializeMonaco();
  ensureDocumentLanguageProviders(api);
  applyMonacoTheme(settings.value.appearance.theme);
  const monacoTheme = currentMonacoTheme(settings.value.appearance.theme);
  api.editor.setTheme(monacoTheme);
  editor = api.editor.create(hostRef.value, {
    model: props.model,
    ...monacoEditorPreferences(props.editorSettings),
    automaticLayout: false,
    accessibilitySupport: "auto",
    autoDetectHighContrast: true,
    screenReaderAnnounceInlineSuggestion: true,
    autoClosingBrackets: "always",
    autoClosingQuotes: "always",
    autoClosingDelete: "always",
    autoClosingOvertype: "auto",
    autoSurround: "languageDefined",
    stickyTabStops: true,
    // Markdown has no document formatter. Indent-on-paste is native; do not
    // reformat the source on type or paste.
    formatOnType: false,
    formatOnPaste: false,
    // Linked editing stays available for native pair ranges. Fulvid does not
    // add a JSX tag-pair parser; rename stays on headings and fragments.
    linkedEditing: true,
    matchBrackets: "near",
    bracketPairColorization: { enabled: true },
    guides: {
      indentation: true,
      highlightActiveIndentation: true,
      bracketPairs: false,
      bracketPairsHorizontal: false,
      highlightActiveBracketPair: true,
    },
    smartSelect: {
      selectLeadingAndTrailingWhitespace: true,
      selectSubwords: true,
    },
    folding: true,
    foldingHighlight: true,
    foldingStrategy: "auto",
    showFoldingControls: "mouseover",
    unfoldOnClickAfterEndOfLine: true,
    links: true,
    renderLineHighlight: "line",
    renderLineHighlightOnlyWhenFocus: false,
    scrollBeyondLastLine: false,
    wordBasedSuggestions: "off",
    quickSuggestions: { other: "off", comments: "off", strings: "off" },
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: "smart",
    tabCompletion: "onlySnippets",
    snippetSuggestions: "inline",
    unicodeHighlight: {
      ambiguousCharacters: false,
      invisibleCharacters: true,
      nonBasicASCII: false,
    },
    padding: { top: 18, bottom: 18 },
    roundedSelection: false,
    theme: monacoTheme,
    ariaLabel: t("documentLanguage.editing", { path: props.path }),
  });
  applyEditorChrome();
  hostRef.value.addEventListener("paste", onMarkdownPaste, true);
  if (queuedRevealPosition) {
    const queued = queuedRevealPosition;
    queuedRevealPosition = null;
    revealPosition(queued.lineNumber, queued.column);
  }
  languageRegistration = props.rootPath
    ? registerDocumentLanguage(api, props.model, props.rootPath)
    : null;
  frontmatterRegistration = props.rootPath ? null : registerFrontmatterDiagnostics(props.model);

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => emit("save"));
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyS, () =>
    emit("saveAs"),
  );
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyO, () =>
    emit("outline"),
  );
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => find());
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH, () => replace());
  registerMarkdownActions();
  stopLocaleWatch = watch(locale, registerMarkdownActions);
  stopContentWatch = editor.onDidChangeModelContent(queueCommandState);
  stopEditorKeyWatch = editor.onKeyDown((event) => {
    if (event.keyCode === monaco.KeyCode.Escape) {
      emit("escape");
    }
    if (
      event.keyCode === monaco.KeyCode.Enter &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.shiftKey &&
      handleMarkdownEnter()
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  stopScrollWatch = editor.onDidScrollChange((event) => {
    if (event.scrollTopChanged || event.scrollHeightChanged) {
      emitScrollRatio();
    }
  });

  resizeObserver = new ResizeObserver(updateLayout);
  resizeObserver.observe(hostRef.value);
  updateLayout();
  emitCommandState();

  stopThemeWatch = watch(
    () => settings.value.appearance.theme,
    () => queueMicrotask(applyConfiguredMonacoTheme),
  );
  colorScheme = window.matchMedia("(prefers-color-scheme: light)");
  colorScheme.addEventListener("change", onColorSchemeChange);
}

watch(
  () => props.model,
  (model) => {
    if (editor && editor.getModel() !== model) {
      editor.setModel(model);
      languageRegistration?.dispose();
      languageRegistration = props.rootPath
        ? registerDocumentLanguage(initializeMonaco(), model, props.rootPath)
        : null;
      frontmatterRegistration?.dispose();
      frontmatterRegistration = props.rootPath ? null : registerFrontmatterDiagnostics(model);
      queueCommandState();
    }
  },
);

watch(
  () => props.rootPath,
  (rootPath) => {
    if (!editor) {
      return;
    }
    languageRegistration?.dispose();
    languageRegistration = rootPath
      ? registerDocumentLanguage(initializeMonaco(), props.model, rootPath)
      : null;
    frontmatterRegistration?.dispose();
    frontmatterRegistration = rootPath ? null : registerFrontmatterDiagnostics(props.model);
  },
);

watch([() => props.path, locale], ([path]) => {
  monaco.editor.setModelLanguage(props.model, languageForPath(path));
  editor?.updateOptions({
    ariaLabel: t("documentLanguage.editing", { path }),
  });
});

watch(
  () => props.editorSettings,
  () => {
    applyEditorChrome();
  },
  { deep: true },
);

watch(
  [
    writingFocusActive,
    () => settings.value.appearance.reducedMotion,
    () => settings.value.editor.typewriterScrolling,
  ],
  () => {
    applyEditorChrome();
  },
);

onMounted(mountEditor);

function onHostKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && event.target === hostRef.value) {
    emit("escape");
  }
}

function revealPosition(lineNumber: number, column: number): void {
  if (!editor) {
    queuedRevealPosition = { lineNumber, column };
    return;
  }
  const position = { lineNumber, column };
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
}

function find(): void {
  // In-buffer Monaco find. Global Search is `/search`; Find References is Shift+F12.
  editor?.trigger("keyboard", "actions.find", {});
}

function replace(): void {
  editor?.trigger("keyboard", "editor.action.startFindReplaceAction", {});
}

function markdownKeybindings(action: MarkdownFormatAction): number[] | undefined {
  if (action === "bold") {
    return [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyB];
  }
  if (action === "italic") {
    return [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI];
  }
  if (action === "inlineCode") {
    return [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE];
  }
  if (action === "link") {
    return [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK];
  }
  return undefined;
}

function registerMarkdownActions(): void {
  markdownActions.forEach((disposable) => disposable.dispose());
  markdownActions = [];
  const currentEditor = editor;
  if (!currentEditor) {
    return;
  }
  MARKDOWN_COMMANDS.forEach((command, index) => {
    markdownActions.push(
      currentEditor.addAction({
        id: `fulvid.markdown.${command.action}`,
        label: t(`markdown.${command.action}`),
        keybindings: markdownKeybindings(command.action),
        contextMenuGroupId: "2_markdown",
        contextMenuOrder: index + 1,
        run: () => runMarkdownAction(command.action),
      }),
    );
  });
}

function runMarkdownAction(action: MarkdownFormatAction): void {
  if (!editor) {
    return;
  }
  const model = editor.getModel();
  if (!model) {
    return;
  }
  const text = model.getValue();
  const selections = editor.getSelections() ?? [];
  const result = formatMarkdown(
    text,
    selections.map((selection) => ({
      start: model.getOffsetAt(selection.getStartPosition()),
      end: model.getOffsetAt(selection.getEndPosition()),
    })),
    action,
    { linkMode: settings.value.links.linkMode },
  );
  if (result.edits.length === 0) {
    editor.focus();
    return;
  }
  const nextText = applyTextEdits(text, result.edits);
  editor.executeEdits(
    `fulvid-markdown-${action}`,
    result.edits.map((edit) => ({
      range: monaco.Range.fromPositions(
        model.getPositionAt(edit.start),
        model.getPositionAt(edit.end),
      ),
      text: edit.text,
      forceMoveMarkers: true,
    })),
    result.selections.map((selection) => {
      const start = offsetToPosition(nextText, selection.start);
      const end = offsetToPosition(nextText, selection.end);
      return monaco.Selection.fromPositions(start, end);
    }),
  );
  editor.focus();
  queueCommandState();
}

function focus(): void {
  editor?.focus();
}

async function runEditorAction(action: "undo" | "redo" | "fold" | "unfold"): Promise<void> {
  const model = editor?.getModel();
  if (!model || !editor) {
    return;
  }

  if (action === "undo") {
    await model.undo();
  } else if (action === "redo") {
    await model.redo();
  } else {
    const monacoAction = editor.getAction(action === "fold" ? "editor.fold" : "editor.unfold");
    if (monacoAction?.isSupported()) {
      await monacoAction.run();
    }
  }
  queueCommandState();
}

async function runMonacoAction(actionId: string): Promise<void> {
  const monacoAction = editor?.getAction(actionId);
  if (monacoAction?.isSupported()) {
    await monacoAction.run();
  }
  queueCommandState();
}

defineExpose({
  find,
  focus,
  replace,
  revealPosition,
  runEditorAction,
  runMonacoAction,
  runMarkdownAction,
});

onBeforeUnmount(() => {
  hostRef.value?.removeEventListener("paste", onMarkdownPaste, true);
  stopThemeWatch?.();
  stopThemeWatch = null;
  stopEditorKeyWatch?.dispose();
  stopEditorKeyWatch = null;
  stopScrollWatch?.dispose();
  stopScrollWatch = null;
  stopContentWatch?.dispose();
  stopContentWatch = null;
  stopLocaleWatch?.();
  stopLocaleWatch = null;
  markdownActions.forEach((disposable) => disposable.dispose());
  markdownActions = [];
  if (colorScheme) {
    colorScheme.removeEventListener("change", onColorSchemeChange);
    colorScheme = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  languageRegistration?.dispose();
  languageRegistration = null;
  frontmatterRegistration?.dispose();
  frontmatterRegistration = null;
  editor?.setModel(null);
  editor?.dispose();
  editor = null;
});
</script>

<template>
  <div id="document-editor" ref="hostRef" class="monaco-host" @keydown="onHostKeydown"></div>
</template>

<style scoped lang="scss">
.monaco-host {
  width: 100%;
  height: 100%;
  min-height: 18rem;
  overflow: hidden;
}
</style>
