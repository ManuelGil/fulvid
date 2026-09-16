<script setup lang="ts">
/**
 * Application Composition: shell layout, global shortcuts, and command
 * dispatch. Product behavior stays in Decision Boundaries; this file only
 * chooses what is visible and which existing action to run.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterView, useRoute, useRouter } from "vue-router";

import AppSidebar from "../shell/AppSidebar.vue";
import {
  absolutePath,
  closeWorkspace,
  copyPath,
  copyWorkspacePath,
  openWorkspace,
  refreshWorkspace,
  relativeDocumentPath,
  revealPath,
  revealWorkspaceInExplorer,
  workspace,
  workspaceName,
  validatedFocus,
} from "./workspaceState";
import { APP_ROUTE_NAMES } from "./router";
import { notify } from "./notify";
import ToastHost from "./ToastHost.vue";
import DialogHost from "./DialogHost.vue";
import { activeDialog, confirmDialog, promptFilename, promptQuickOpen } from "./dialogs";
import { confirmAndQuit } from "./applicationQuit";
import {
  describeFilesystemError,
  notifyFilesystemError,
  pickAndOpenDocument,
} from "../modules/workspace/filesystem/workspaceScanner";
import {
  activeBuffer,
  isDocumentDirty,
  openBuffers,
  openOrActivate,
  selectDocument,
} from "../modules/editor/document/documentBuffers";
import {
  documentTemplateTitleFromParentPath,
  renderDocumentTemplate,
} from "../modules/editor/document/documentTemplates";
import { createAndOpenSeededWorkspaceDocument } from "../modules/editor/document/seededWorkspaceDocument";
import { resolveNewDocumentFileName } from "../modules/editor/document/documentFileNames";
import { isMarkdownFile } from "../modules/workspace/filesystem/workspaceTypes";
import {
  documentLocationFromBuffer,
  windowTitleForDocumentLocation,
} from "../modules/editor/document/documentLocation";
import {
  activeId,
  nextMruDocument,
  pendingReveal,
} from "../modules/editor/document/documentSession";
import {
  closeInspector,
  inspectorOpen,
  noteTitle,
  openInspector,
  peekDocument,
} from "../modules/workspace/focus/focusState";
import { isTextEntryTarget } from "./isTypingTarget";
import {
  closeLeftSidebar,
  closeRightSidebar,
  CONTEXTUAL_WIDTH_LIMITS,
  leftSidebarOpen,
  layout,
  openLeftSidebar,
  openRightSidebar,
  rightSidebar,
  setContextualWidth,
  toggleLeftSidebar,
  toggleRightSidebar,
  type RightSidebar,
} from "./layoutStore";
import AppIcon from "../shell/AppIcon.vue";
import ApplicationMenu from "../shell/ApplicationMenu.vue";
import {
  applicationMenuSupport,
  quitApplication,
  resolveApplicationMenuSupport,
  syncNativeApplicationMenu,
  usesHtmlApplicationMenuFallback,
  usesNativeApplicationMenu,
} from "../shell/applicationMenu/applicationMenuClient";
import {
  integrateExtensionActionsIntoMenus,
  presentApplicationMenu,
  type ApplicationMenuState,
} from "../shell/applicationMenu/applicationMenuModel";
import { desktopRequest, onApplicationMenuClicked } from "../desktop/electrobunClient";
import {
  configureExtensionHostActions,
  listExtensionMenuCommands,
  runExtensionCommand,
  setDiscoveredExtensions,
} from "../extensions/extensionRegistry";
import { editorCommandState } from "../modules/editor/editorCommandState";
import {
  toggleWritingFocus,
  writingFocusActive,
  writingFocusHidesEditorChrome,
} from "../modules/editor/writingFocus";
import {
  documentAnnotationsVisible,
  syncDocumentAnnotationsVisibleFromPreference,
  toggleDocumentAnnotationsVisible,
} from "../modules/editor/document/documentAnnotationVisibility";
import { isUsableFocusTarget } from "./usableFocusTarget";
import QuickActionsToolbar from "../shell/QuickActionsToolbar.vue";
import OutlinePanel from "../modules/editor/outline/OutlinePanel.vue";
import Statusbar from "../shell/Statusbar.vue";
import {
  executeCommand,
  hasCommandHandler,
  registerCommandHandler,
  waitForCommandHandler,
  type CommandId,
} from "../shell/commands";
import { MARKDOWN_COMMANDS } from "../modules/editor/markdown/markdownFormat";
import InspectorDrawer from "../modules/document/inspector/InspectorDrawer.vue";
import { patchSettings, settings } from "../modules/settings/settingsStore";
import ExplorerPanel from "../modules/workspace/explorer/ExplorerPanel.vue";
import SearchSidebar from "../modules/search/SearchSidebar.vue";

const RIGHT_PANEL_CONFIG = {
  explorer: { component: ExplorerPanel, label: "files.title" },
  search: { component: SearchSidebar, label: "app.searchPanel" },
  outline: { component: OutlinePanel, label: "actions.outline" },
  context: { component: InspectorDrawer, label: "actions.context" },
} as const;

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const narrowViewport = ref(
  typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
);
let narrowViewportMedia: MediaQueryList | null = null;

function preventDragDropNavigation(event: DragEvent): void {
  event.preventDefault();
}

function onNarrowViewportChange(event: MediaQueryListEvent): void {
  narrowViewport.value = event.matches;
}

const activeRightPanel = computed<RightSidebar>(() => {
  if (
    route.name === APP_ROUTE_NAMES.editor ||
    route.name === APP_ROUTE_NAMES.search ||
    route.name === APP_ROUTE_NAMES.graph
  ) {
    if (rightSidebar.value === "context" && !inspectorOpen.value) {
      return null;
    }
    return rightSidebar.value;
  }
  return null;
});

const editorFocusChrome = computed(() => writingFocusHidesEditorChrome(route.name));

/** Narrow overlays. Focus hides the left sidebar, so it must not count as an overlay. */
const overlayOpen = computed(
  () =>
    narrowViewport.value &&
    (Boolean(activeRightPanel.value) || (!editorFocusChrome.value && leftSidebarOpen.value)),
);
let leftSidebarReturnFocus: HTMLElement | null = null;
let rightPanelReturnFocus: HTMLElement | null = null;
let contextualResizeCleanup: (() => void) | null = null;

function focusOrReturnToMain(element: HTMLElement | null): void {
  if (isUsableFocusTarget(element)) {
    element.focus({ preventScroll: true });
    return;
  }
  const main = document.getElementById("main-content");
  if (isUsableFocusTarget(main)) {
    main.focus({ preventScroll: true });
  }
}

/** Skip sidebar open/close auto-focus when Strong Writing Focus collapses/restores the rail. */
let suppressSidebarAutoFocus = false;

watch(
  leftSidebarOpen,
  async (open, wasOpen) => {
    if (open && !wasOpen) {
      if (
        document.activeElement instanceof HTMLElement &&
        !document.activeElement.closest(".app-sidebar")
      ) {
        leftSidebarReturnFocus = document.activeElement;
      }
      if (narrowViewport.value && activeRightPanel.value) {
        closeRightSidebar();
      }
      await nextTick();
      if (suppressSidebarAutoFocus) {
        suppressSidebarAutoFocus = false;
        return;
      }
      document
        .querySelector<HTMLElement>(
          ".app-sidebar:not(.app-sidebar--compact) .app-sidebar__collapse",
        )
        ?.focus({ preventScroll: true });
      return;
    }

    if (!open && wasOpen) {
      if (narrowViewport.value && activeRightPanel.value) {
        suppressSidebarAutoFocus = false;
        leftSidebarReturnFocus = null;
        return;
      }
      await nextTick();
      if (suppressSidebarAutoFocus) {
        suppressSidebarAutoFocus = false;
        leftSidebarReturnFocus = null;
        return;
      }
      const compactButton = document.querySelector<HTMLElement>(
        ".app-sidebar--compact .app-sidebar__compact-header .app-sidebar__compact-button",
      );
      focusOrReturnToMain(compactButton ?? leftSidebarReturnFocus);
      leftSidebarReturnFocus = null;
    }
  },
  { flush: "post" },
);

watch(
  activeRightPanel,
  async (panel, previousPanel) => {
    if (panel && !previousPanel) {
      if (
        document.activeElement instanceof HTMLElement &&
        !document.activeElement.closest(".app-shell__panel")
      ) {
        rightPanelReturnFocus = document.activeElement;
      }
      if (narrowViewport.value && leftSidebarOpen.value) {
        closeLeftSidebar();
      }
      await nextTick();
      if (narrowViewport.value) {
        document.querySelector<HTMLElement>(".app-shell__panel-close")?.focus({
          preventScroll: true,
        });
      }
      return;
    }

    if (!panel && previousPanel) {
      if (narrowViewport.value && leftSidebarOpen.value) {
        rightPanelReturnFocus = null;
        return;
      }
      await nextTick();
      focusOrReturnToMain(rightPanelReturnFocus);
      rightPanelReturnFocus = null;
    }
  },
  { flush: "post" },
);

const activeRightPanelComponent = computed(() => {
  const panel = activeRightPanel.value;
  return panel ? RIGHT_PANEL_CONFIG[panel].component : null;
});

const contextPanelLabel = computed(() => {
  const panel = activeRightPanel.value;
  return panel ? t(RIGHT_PANEL_CONFIG[panel].label) : "";
});

const activeRightPanelProps = computed(() =>
  activeRightPanel.value === "context" ? { embedded: true } : {},
);

watch(
  inspectorOpen,
  (open) => {
    if (open) {
      openRightSidebar("context");
    } else if (rightSidebar.value === "context") {
      closeRightSidebar();
    }
  },
  { flush: "sync" },
);

function syncRoutePanel(routeName: unknown): void {
  if (rightSidebar.value === "context" && !inspectorOpen.value) {
    closeRightSidebar();
  }
  if (routeName === APP_ROUTE_NAMES.search) {
    if (narrowViewport.value) {
      closeLeftSidebar();
      closeRightSidebar();
    } else {
      openRightSidebar("search");
    }
  } else if (routeName === APP_ROUTE_NAMES.editor && rightSidebar.value === "search") {
    closeRightSidebar();
  } else if (routeName === APP_ROUTE_NAMES.graph && rightSidebar.value !== "context") {
    closeRightSidebar();
  } else if (routeName !== APP_ROUTE_NAMES.editor && routeName !== APP_ROUTE_NAMES.graph) {
    closeRightSidebar();
  }
}

watch(() => route.name, syncRoutePanel, { immediate: true });

watch(narrowViewport, (narrow) => {
  if (narrow && leftSidebarOpen.value && activeRightPanel.value) {
    closeRightSidebar();
  }
  syncRoutePanel(route.name);
});

function closeContextPanel(): void {
  closeRightSidebar();
  if (inspectorOpen.value) {
    closeInspector();
  }
}

function activateAdjacentDocument(direction: -1 | 1): void {
  const currentIndex = openBuffers.value.findIndex((buffer) => buffer.id === activeId.value);
  if (currentIndex < 0 || openBuffers.value.length < 2) {
    return;
  }
  const nextIndex =
    (currentIndex + direction + openBuffers.value.length) % openBuffers.value.length;
  const nextBuffer = openBuffers.value[nextIndex];
  if (!nextBuffer) {
    return;
  }
  selectDocument(nextBuffer.id);
}

function activateMruDocument(direction: 1 | -1): void {
  const nextId = nextMruDocument(direction);
  if (!nextId) {
    activateAdjacentDocument(direction);
    return;
  }
  const nextBuffer = openBuffers.value.find((buffer) => buffer.id === nextId);
  if (!nextBuffer) {
    return;
  }
  selectDocument(nextId);
}

function overlayFocusableElements(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      ".app-sidebar--overlay button, .app-sidebar--overlay [role='button'], .app-sidebar--overlay input, .app-sidebar--overlay select, .app-sidebar--overlay textarea, .app-sidebar--overlay a[href], .app-shell__scrim, .app-shell__panel button, .app-shell__panel [role='button'], .app-shell__panel [role='slider'], .app-shell__panel input, .app-shell__panel select, .app-shell__panel textarea, .app-shell__panel a[href]",
    ),
  ].filter(
    (element) =>
      !element.hasAttribute("disabled") &&
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0,
  );
}

function handleModifierShortcut(event: KeyboardEvent, insideMonaco: boolean): boolean {
  const modifier = event.metaKey || event.ctrlKey;
  if (!modifier) {
    return false;
  }

  if (
    !insideMonaco &&
    event.target instanceof HTMLElement &&
    event.target.matches("input, textarea, select, [contenteditable='true']")
  ) {
    return false;
  }

  const key = event.key.toLowerCase();
  if (
    usesNativeApplicationMenu() &&
    !event.shiftKey &&
    !event.altKey &&
    ["n", "o", "s", "w", "f", "h", "p"].includes(key)
  ) {
    return false;
  }
  if (event.altKey && key === "w") {
    event.preventDefault();
    void runCommand("closeOthers");
    return true;
  }
  if (event.altKey) {
    return false;
  }

  if (!insideMonaco && key === "s") {
    event.preventDefault();
    void runCommand(event.shiftKey ? "saveAs" : "save");
    return true;
  }
  if (event.shiftKey && key === "enter") {
    event.preventDefault();
    toggleWritingFocus();
    return true;
  }
  if (event.shiftKey && key === "f") {
    event.preventDefault();
    openGlobalSearch();
    return true;
  }
  if (event.shiftKey && key === "e") {
    event.preventDefault();
    toggleLeftSidebar();
    return true;
  }
  if (event.shiftKey && key === "o") {
    event.preventDefault();
    void runCommand("openOutline");
    return true;
  }
  if (!event.shiftKey && key === "p") {
    event.preventDefault();
    void runCommand("openQuickOpen");
    return true;
  }
  if (!event.shiftKey && key === "n") {
    event.preventDefault();
    void runCommand("newDocument");
    return true;
  }
  if (!event.shiftKey && key === "o") {
    event.preventDefault();
    void runCommand("openFile");
    return true;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    activateMruDocument(event.shiftKey ? -1 : 1);
    return true;
  }
  if (event.key === "PageDown") {
    event.preventDefault();
    activateAdjacentDocument(1);
    return true;
  }
  if (event.key === "PageUp") {
    event.preventDefault();
    activateAdjacentDocument(-1);
    return true;
  }
  if (key === "w") {
    event.preventDefault();
    void runCommand("closeDocument");
    return true;
  }
  return false;
}

function trapOverlayTab(event: KeyboardEvent): boolean {
  if (!overlayOpen.value || event.key !== "Tab") {
    return false;
  }

  const focusable = overlayFocusableElements();
  if (focusable.length === 0) {
    return false;
  }

  const currentIndex = focusable.indexOf(
    document.activeElement instanceof HTMLElement ? document.activeElement : focusable[0],
  );
  const nextIndex = event.shiftKey
    ? currentIndex <= 0
      ? focusable.length - 1
      : currentIndex - 1
    : currentIndex >= focusable.length - 1
      ? 0
      : currentIndex + 1;
  event.preventDefault();
  focusable[nextIndex]?.focus();
  return true;
}

function handleNavigationShortcut(event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  if (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isTextEntryTarget(event.target) ||
    !["/", "1", "2", "3", "i", "g"].includes(key)
  ) {
    return false;
  }

  if (key === "/") {
    event.preventDefault();
    openGlobalSearch();
    return true;
  }
  if (key === "1" || key === "2" || key === "3") {
    event.preventDefault();
    void router.push({
      name:
        key === "1"
          ? APP_ROUTE_NAMES.editor
          : key === "2"
            ? APP_ROUTE_NAMES.search
            : APP_ROUTE_NAMES.graph,
    });
    return true;
  }
  if (key === "i") {
    if (!validatedFocus.value || route.name === APP_ROUTE_NAMES.graph) {
      return false;
    }
    event.preventDefault();
    if (inspectorOpen.value) {
      closeInspector();
    } else {
      peekDocument(validatedFocus.value.path);
    }
    return true;
  }
  event.preventDefault();
  void router.push({ name: APP_ROUTE_NAMES.graph });
  return true;
}

function closePanelsOnEscape(event: KeyboardEvent): boolean {
  if (
    event.key !== "Escape" ||
    event.defaultPrevented ||
    (event.target instanceof Element && Boolean(event.target.closest(".monaco-editor")))
  ) {
    return false;
  }

  if (activeRightPanel.value) {
    event.preventDefault();
    closeContextPanel();
    return true;
  }
  if (leftSidebarOpen.value && narrowViewport.value) {
    event.preventDefault();
    toggleLeftSidebar();
    return true;
  }
  return false;
}

function onAppKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || activeDialog.value) {
    return;
  }

  if (event.key === "F11" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
    event.preventDefault();
    void runCommand("toggleFullscreen");
    return;
  }
  if (
    event.key.toLowerCase() === "f" &&
    event.ctrlKey &&
    event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  ) {
    event.preventDefault();
    void runCommand("toggleFullscreen");
    return;
  }

  const insideMonaco =
    event.target instanceof Element && Boolean(event.target.closest(".monaco-editor"));
  if (handleModifierShortcut(event, insideMonaco)) {
    return;
  }

  if (trapOverlayTab(event)) {
    return;
  }

  if (handleNavigationShortcut(event)) {
    return;
  }
  closePanelsOnEscape(event);
}

function startContextualResize(event: PointerEvent): void {
  event.preventDefault();
  contextualResizeCleanup?.();
  const startX = event.clientX;
  const startWidth = layout.value.contextualWidth;
  let cleanup = (): void => {};
  const onMove = (moveEvent: PointerEvent): void => {
    setContextualWidth(startWidth + (startX - moveEvent.clientX));
  };
  const onUp = (): void => {
    cleanup();
    if (contextualResizeCleanup === cleanup) {
      contextualResizeCleanup = null;
    }
  };
  cleanup = (): void => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  contextualResizeCleanup = cleanup;
}

const unregisterNativeMenu = onApplicationMenuClicked((action) => {
  void runShellCommand(action);
});

onMounted(() => {
  syncDocumentAnnotationsVisibleFromPreference(settings.value.editor.showDocumentAnnotations);
  configureExtensionHostActions({
    notify: (message) => notify(message),
    createUntitled: (content) => createNewDocument(content),
    invokeLuaCommand: (request) => desktopRequest().invokeExtensionLuaCommand(request),
  });
  void desktopRequest()
    .listDiscoveredExtensions({})
    .then((result) => {
      setDiscoveredExtensions(result);
      // Startup toasts only for failed/blocked packs; Settings holds the inventory.
      for (const failure of result.failed) {
        notify(t("extensions.loadFailed", { id: failure.id }));
      }
    })
    .catch((error: unknown) => {
      console.warn("Fulvid extension discovery unavailable:", error);
      notify(t("extensions.discoveryUnavailable"));
    });
  void resolveApplicationMenuSupport().then(() => {
    void syncNativeApplicationMenu(presentedApplicationMenus.value);
  });
  window.addEventListener("dragenter", preventDragDropNavigation);
  window.addEventListener("dragover", preventDragDropNavigation);
  window.addEventListener("drop", preventDragDropNavigation);
  window.addEventListener("keydown", onAppKeydown);
  narrowViewportMedia = window.matchMedia("(max-width: 900px)");
  narrowViewport.value = narrowViewportMedia.matches;
  narrowViewportMedia.addEventListener("change", onNarrowViewportChange);
});

const routeLabel = computed(() => {
  if (activeRightPanel.value) {
    return contextPanelLabel.value;
  }
  if (route.name === APP_ROUTE_NAMES.search) {
    return t("nav.search");
  }
  if (route.name === APP_ROUTE_NAMES.graph) {
    return t("nav.graph");
  }
  if (route.name === APP_ROUTE_NAMES.settings) {
    return t("nav.settings");
  }
  return t("nav.editor");
});

const routeAnnouncement = computed(() => {
  const workspaceLabel = workspace.value ? workspaceName(workspace.value.path) : "";
  const location = documentLocationFromBuffer(activeBuffer.value);
  const documentLabel = location
    ? `${location.full}${
        activeBuffer.value && isDocumentDirty(activeBuffer.value)
          ? ` · ${t("tabs.unsavedChanges")}`
          : ""
      }`
    : validatedFocus.value
      ? noteTitle(validatedFocus.value.path, workspace.value?.scannedNotes ?? [])
      : "";

  return [documentLabel, routeLabel.value, workspaceLabel].filter(Boolean).join(" · ");
});

const writingFocusAnnouncement = ref("");
watch(writingFocusActive, (active) => {
  writingFocusAnnouncement.value = active
    ? t("actions.writingFocusOn")
    : t("actions.writingFocusOff");
});

/** Restore left sidebar after Writing Focus collapses it. */
const leftSidebarBeforeWritingFocus = ref<boolean | null>(null);

watch(editorFocusChrome, (hiding) => {
  if (hiding) {
    if (leftSidebarBeforeWritingFocus.value === null) {
      leftSidebarBeforeWritingFocus.value = leftSidebarOpen.value;
    }
    // Collapse to the existing compact rail; do not hide/inert the rail.
    // Do not auto-focus the rail - leave keyboard focus on Monaco / Quick Actions.
    if (leftSidebarOpen.value) {
      suppressSidebarAutoFocus = true;
      closeLeftSidebar();
    }
    return;
  }
  if (leftSidebarBeforeWritingFocus.value !== null) {
    if (leftSidebarBeforeWritingFocus.value) {
      suppressSidebarAutoFocus = true;
      openLeftSidebar();
    }
    leftSidebarBeforeWritingFocus.value = null;
  }
});

watch(
  [
    () => activeBuffer.value?.id,
    () => activeBuffer.value?.path,
    () => activeBuffer.value?.title,
    () => activeBuffer.value?.absolutePath,
    () => settings.value.editor.documentLocation,
  ],
  () => {
    const location = documentLocationFromBuffer(activeBuffer.value);
    const title = windowTitleForDocumentLocation(
      "Fulvid",
      location,
      settings.value.editor.documentLocation,
    );
    void desktopRequest()
      .setWindowTitle({ title })
      .catch(() => {
        // Host title is presentation-only; failure must not block editing.
      });
  },
  { immediate: true },
);

const liveAnnouncement = computed(() =>
  [routeAnnouncement.value, writingFocusAnnouncement.value].filter(Boolean).join(" · "),
);

async function createNewDocument(content?: string): Promise<void> {
  try {
    closeRightSidebar();
    if (content === undefined) {
      await openOrActivate({ kind: "virtual" });
    } else {
      await openOrActivate({ kind: "virtual", content });
    }
    await router.push({ name: APP_ROUTE_NAMES.editor });
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", notify);
  }
}

/**
 * With a folder open: prompt and write a README-shaped file at the Folder root
 * (File / Quick Actions have no Explorer selection; Explorer New uses the
 * selected directory). Without a folder: untitled buffer until Save As.
 */
async function createNewDocumentFromReadme(): Promise<void> {
  const rootPath = workspace.value?.path;
  if (!rootPath) {
    await createNewDocument(
      renderDocumentTemplate("readme", {
        title: documentTemplateTitleFromParentPath("", null),
      }),
    );
    return;
  }

  const requestedName = await promptFilename({
    title: t("files.newDocumentFromReadme"),
    label: t("files.newDocumentName"),
    initialValue: `README.${settings.value.links.defaultExtension}`,
  });
  if (!requestedName) {
    return;
  }
  const fileName = resolveNewDocumentFileName(requestedName, settings.value.links.defaultExtension);
  if (!fileName) {
    const withExtension = requestedName.includes(".")
      ? requestedName
      : `${requestedName}.${settings.value.links.defaultExtension}`;
    notify(
      isMarkdownFile(withExtension) ? t("filesystemErrors.unsafeName") : t("files.supportedOnly"),
    );
    return;
  }

  try {
    closeRightSidebar();
    await createAndOpenSeededWorkspaceDocument({
      rootPath,
      parentRelativePath: "",
      fileName,
      content: renderDocumentTemplate("readme", {
        title: documentTemplateTitleFromParentPath("", workspaceName(rootPath)),
      }),
      linkMode: settings.value.links.linkMode,
    });
    void refreshWorkspace({ silent: true });
    await router.push({ name: APP_ROUTE_NAMES.editor });
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", notify);
  }
}

async function openFileDocument(): Promise<void> {
  try {
    const snapshot = await pickAndOpenDocument();
    if (!snapshot) {
      return;
    }
    const attachment =
      workspace.value && snapshot.absolutePath
        ? relativeDocumentPath(workspace.value.path, snapshot.absolutePath)
        : null;
    await openOrActivate({
      kind: "granted",
      snapshot,
      ...(attachment ? { attachment: { rootPath: workspace.value!.path, path: attachment } } : {}),
    });
    closeRightSidebar();
    await router.push({ name: APP_ROUTE_NAMES.editor });
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", notify);
  }
}

function openGlobalSearch(): void {
  closeInspector();
  if (narrowViewport.value) {
    closeLeftSidebar();
    closeRightSidebar();
  } else {
    openRightSidebar("search");
  }
  void router.push({ name: APP_ROUTE_NAMES.search }).then(() => {
    requestAnimationFrame(() => {
      document.getElementById("search-query")?.focus();
    });
  });
}

/**
 * Entry point for Quick Open (Ctrl/Cmd+P).
 *
 * Candidates: live `workspace.scannedNotes` via DialogHost /
 * `quickOpenCandidatesFromNotes`. Overlay: `promptQuickOpen`.
 * Open: `openOrActivate` -> `selectDocument`.
 * Global Search stays `openGlobalSearch` (Ctrl/Cmd+Shift+F).
 */
async function openQuickOpen(): Promise<void> {
  const path = await promptQuickOpen();
  if (!path) {
    return;
  }
  const rootPath = workspace.value?.path;
  if (!rootPath) {
    // Selection succeeded but Folder is gone - fail visibly, not silently.
    notify(t("workspace.noWorkspace"));
    return;
  }
  try {
    await openOrActivate({
      kind: "workspace",
      rootPath,
      path,
    });
    await router.push({ name: APP_ROUTE_NAMES.editor });
  } catch (error) {
    notifyFilesystemError(error, "workspace.openDocumentError", notify);
  }
}

function openExplorer(): void {
  if (route.name !== APP_ROUTE_NAMES.editor) {
    openRightSidebar("explorer");
    void router.push({ name: APP_ROUTE_NAMES.editor });
    return;
  }
  toggleRightSidebar("explorer");
}

function openOutline(): void {
  openRightSidebar("outline");
  if (route.name !== APP_ROUTE_NAMES.editor) {
    void router.push({ name: APP_ROUTE_NAMES.editor });
  }
}

function toggleContextPanel(): void {
  if (activeRightPanel.value === "context") {
    closeContextPanel();
    return;
  }
  if (route.name !== APP_ROUTE_NAMES.editor && route.name !== APP_ROUTE_NAMES.graph) {
    void router.push({ name: APP_ROUTE_NAMES.editor });
  }
  if (validatedFocus.value) {
    peekDocument(validatedFocus.value.path);
  } else {
    openInspector();
  }
}

const compactRightPanels = computed<
  readonly {
    id: Exclude<RightSidebar, null>;
    label: string;
    icon: "folder" | "search" | "document";
  }[]
>(() => {
  if (route.name === APP_ROUTE_NAMES.search) {
    return [{ id: "search", label: t("app.searchPanel"), icon: "search" }];
  }
  if (route.name === APP_ROUTE_NAMES.graph) {
    return [{ id: "context", label: t("actions.context"), icon: "document" }];
  }
  if (route.name === APP_ROUTE_NAMES.editor) {
    return [
      { id: "explorer", label: t("actions.explorer"), icon: "folder" },
      { id: "context", label: t("actions.context"), icon: "document" },
      { id: "outline", label: t("actions.outline"), icon: "document" },
    ];
  }
  return [];
});

function activateCompactRightPanel(panel: Exclude<RightSidebar, null>): void {
  if (panel === "search") {
    openGlobalSearch();
    return;
  }
  if (panel === "explorer") {
    openExplorer();
    return;
  }
  if (panel === "outline") {
    if (activeRightPanel.value === "outline") {
      closeContextPanel();
      return;
    }
    openOutline();
    return;
  }
  toggleContextPanel();
}

function toggleStatusbar(): void {
  patchSettings({
    appearance: {
      ...settings.value.appearance,
      statusbar: {
        ...settings.value.appearance.statusbar,
        enabled: !settings.value.appearance.statusbar.enabled,
      },
    },
  });
}

function activeDocumentPath(): string | null {
  const buffer = activeBuffer.value;
  if (!buffer) {
    return null;
  }
  if (buffer.absolutePath) {
    return buffer.absolutePath;
  }
  if (buffer.rootPath && buffer.path) {
    return absolutePath(buffer.rootPath, buffer.path);
  }
  return null;
}

async function toggleFullscreen(): Promise<void> {
  try {
    await desktopRequest().toggleWindowFullScreen({});
  } catch {
    // Native toggle failed. Stay windowed; do not use web fullscreen.
  }
}

const applicationMenuState = computed<ApplicationMenuState>(() => {
  const buffer = activeBuffer.value;
  return {
    hasActiveDocument: Boolean(buffer),
    isVirtualDocument: buffer?.kind === "virtual",
    hasDocumentPath: Boolean(activeDocumentPath()),
    isDocumentDirty: buffer ? isDocumentDirty(buffer) : false,
    tabCount: openBuffers.value.length,
    hasFolder: Boolean(workspace.value),
    previewEnabled: settings.value.preview.enabled,
    leftSidebarOpen: leftSidebarOpen.value,
    rightSidebarOpen: Boolean(activeRightPanel.value),
    statusbarEnabled: settings.value.appearance.statusbar.enabled,
    writingFocus: writingFocusActive.value,
    documentAnnotationsVisible: documentAnnotationsVisible.value,
    canUndo: editorCommandState.value.canUndo,
    canRedo: editorCommandState.value.canRedo,
  };
});

const presentedApplicationMenus = computed(() =>
  integrateExtensionActionsIntoMenus(
    presentApplicationMenu(
      applicationMenuSupport.value?.platform ?? "other",
      applicationMenuState.value,
      t,
    ),
    listExtensionMenuCommands(),
  ),
);

watch(
  presentedApplicationMenus,
  (menus) => {
    void syncNativeApplicationMenu(menus);
  },
  { deep: true },
);

function revealOutlinePosition(lineNumber: number, column: number): void {
  const documentId = activeId.value;
  if (!documentId) {
    return;
  }
  pendingReveal.value = { documentId, lineNumber, column };
  if (route.name !== APP_ROUTE_NAMES.editor) {
    void router.push({ name: APP_ROUTE_NAMES.editor });
  }
}

const unregisterCommands = [
  registerCommandHandler("newDocument", () => createNewDocument()),
  registerCommandHandler("newDocumentFromReadme", () => createNewDocumentFromReadme()),
  registerCommandHandler("toggleWritingFocus", toggleWritingFocus),
  registerCommandHandler("toggleDocumentAnnotations", () => {
    const visible = toggleDocumentAnnotationsVisible();
    notify(t(visible ? "documentAnnotations.shown" : "documentAnnotations.hidden"));
  }),
  registerCommandHandler("openFile", openFileDocument),
  registerCommandHandler("openWorkspace", openWorkspace),
  registerCommandHandler("closeWorkspace", closeWorkspace),
  registerCommandHandler("refreshWorkspace", () => refreshWorkspace()),
  registerCommandHandler("revealWorkspace", revealWorkspaceInExplorer),
  registerCommandHandler("copyWorkspacePath", copyWorkspacePath),
  registerCommandHandler("toggleLeftSidebar", toggleLeftSidebar),
  registerCommandHandler("toggleRightSidebar", () => {
    if (route.name !== APP_ROUTE_NAMES.editor && route.name !== APP_ROUTE_NAMES.search) {
      openExplorer();
      return;
    }
    const panel = route.name === APP_ROUTE_NAMES.search ? "search" : "explorer";
    toggleRightSidebar(panel);
  }),
  registerCommandHandler("openExplorer", openExplorer),
  registerCommandHandler("openQuickOpen", openQuickOpen),
  registerCommandHandler("openGlobalSearch", openGlobalSearch),
  registerCommandHandler("openOutline", openOutline),
  registerCommandHandler("toggleStatusbar", toggleStatusbar),
  registerCommandHandler("openSettings", () => {
    void router.push({ name: APP_ROUTE_NAMES.settings });
  }),
  registerCommandHandler("openExtensions", () => {
    void router.push({ name: APP_ROUTE_NAMES.settings, query: { section: "extensions" } });
  }),
  registerCommandHandler("openEditor", () => {
    void router.push({ name: APP_ROUTE_NAMES.editor });
  }),
  registerCommandHandler("openGraph", () => {
    void router.push({ name: APP_ROUTE_NAMES.graph });
  }),
  registerCommandHandler("nextTab", () => activateAdjacentDocument(1)),
  registerCommandHandler("previousTab", () => activateAdjacentDocument(-1)),
  registerCommandHandler("revealDocument", () => {
    const path = activeDocumentPath();
    if (path) {
      void revealPath(path);
    }
  }),
  registerCommandHandler("copyDocumentPath", () => {
    const path = activeDocumentPath();
    if (path) {
      void copyPath(path);
    }
  }),
  registerCommandHandler("openKeyboardShortcuts", () => {
    void router.push({ name: APP_ROUTE_NAMES.settings, query: { section: "keyboard" } });
  }),
  registerCommandHandler("openAbout", () => {
    void router.push({ name: APP_ROUTE_NAMES.settings, query: { section: "general" } });
  }),
  registerCommandHandler("toggleFullscreen", toggleFullscreen),
  registerCommandHandler("quit", () => {
    void requestApplicationQuit();
  }),
];

async function requestApplicationQuit(): Promise<void> {
  const dirtyCount = openBuffers.value.filter(isDocumentDirty).length;
  await confirmAndQuit({
    dirtyCount,
    confirmCloseEnabled: settings.value.workspace.confirmClose,
    confirm: () =>
      confirmDialog(
        dirtyCount === 1
          ? t("workspace.quitUnsavedOne", {
              name: openBuffers.value.find(isDocumentDirty)?.title ?? "",
            })
          : t("workspace.quitUnsaved", { count: dirtyCount }),
      ),
    quit: quitApplication,
  });
}

const editorCommandIds = new Set<CommandId>([
  "save",
  "saveAs",
  "exportHtml",
  "closeDocument",
  "closeOthers",
  "closeAll",
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "selectAll",
  "indentLines",
  "outdentLines",
  "duplicateSelection",
  "trimTrailingWhitespace",
  "find",
  "replace",
  "findReferences",
  "renameHeading",
  "insertDocumentLink",
  "newDocumentFromSelection",
  "insertTableOfContents",
  "togglePreview",
  "deleteSelection",
  "annotateDocument",
  "removeAnnotation",
  "nextAnnotation",
  "previousAnnotation",
  "clearAnnotations",
  ...MARKDOWN_COMMANDS.map((command) => command.id),
]);

async function runShellCommand(id: string): Promise<void> {
  try {
    if (await runExtensionCommand(id)) {
      return;
    }
    await runCommand(id as CommandId);
  } catch (error: unknown) {
    notify(describeFilesystemError(error, "app.commandError"));
  }
}

async function runCommand(id: CommandId): Promise<void> {
  try {
    const requiresEditor = editorCommandIds.has(id);
    if (requiresEditor && route.name !== APP_ROUTE_NAMES.editor) {
      await router.push({ name: APP_ROUTE_NAMES.editor });
    }
    if (requiresEditor && !hasCommandHandler(id)) {
      const ready = await waitForCommandHandler(id);
      if (!ready) {
        return;
      }
    }
    await executeCommand(id);
  } catch (error: unknown) {
    notify(describeFilesystemError(error, "app.commandError"));
  }
}

onBeforeUnmount(() => {
  contextualResizeCleanup?.();
  contextualResizeCleanup = null;
  window.removeEventListener("dragenter", preventDragDropNavigation);
  window.removeEventListener("dragover", preventDragDropNavigation);
  window.removeEventListener("drop", preventDragDropNavigation);
  window.removeEventListener("keydown", onAppKeydown);
  narrowViewportMedia?.removeEventListener("change", onNarrowViewportChange);
  unregisterCommands.forEach((unregister) => unregister());
  unregisterNativeMenu();
});
</script>

<template>
  <div
    class="app-shell"
    :inert="Boolean(activeDialog)"
    :class="{
      'app-shell--editor': route.name === APP_ROUTE_NAMES.editor,
      'app-shell--search': route.name === APP_ROUTE_NAMES.search,
      'app-shell--graph': route.name === APP_ROUTE_NAMES.graph,
      'app-shell--settings': route.name === APP_ROUTE_NAMES.settings,
    }"
  >
    <a class="skip-link" href="#main-content">{{ t("app.skipToContent") }}</a>
    <div class="sr-only" aria-live="polite" aria-atomic="true">
      {{ liveAnnouncement }}
    </div>

    <header class="app-shell__chrome">
      <div
        v-if="usesHtmlApplicationMenuFallback()"
        class="app-shell__menu-row"
        data-application-menu="html-fallback"
      >
        <ApplicationMenu :menus="presentedApplicationMenus" @command="runShellCommand" />
      </div>
      <!-- Writing Focus must not hide/inert this row: Quick Actions stay a capability. -->
      <div class="app-shell__actions-row" :inert="overlayOpen">
        <QuickActionsToolbar
          :explorer-open="activeRightPanel === 'explorer'"
          :run-command="runShellCommand"
        />
      </div>
    </header>

    <div class="app-shell__body">
      <AppSidebar
        :compact="!leftSidebarOpen"
        :overlay="narrowViewport && leftSidebarOpen"
        :inert="overlayOpen && !leftSidebarOpen"
      />
      <button
        v-if="leftSidebarOpen && !editorFocusChrome"
        class="app-shell__scrim app-shell__scrim--left"
        type="button"
        :aria-label="t('actions.hideLeftSidebar')"
        @click="closeLeftSidebar"
      />
      <main
        id="main-content"
        class="app-shell__main"
        tabindex="-1"
        :inert="
          narrowViewport && (Boolean(activeRightPanel) || (!editorFocusChrome && leftSidebarOpen))
        "
      >
        <div class="app-shell__stage">
          <div class="app-shell__page">
            <RouterView v-slot="{ Component }">
              <component :is="Component" />
            </RouterView>
          </div>
        </div>
      </main>

      <button
        v-if="activeRightPanel"
        class="app-shell__scrim app-shell__scrim--right"
        type="button"
        :aria-label="t('actions.closePanel')"
        @click="closeContextPanel"
      />
      <aside
        v-if="activeRightPanel && activeRightPanelComponent"
        class="app-shell__panel"
        :role="narrowViewport ? 'dialog' : 'complementary'"
        :aria-modal="narrowViewport ? 'true' : undefined"
        :aria-label="contextPanelLabel"
      >
        <div
          class="app-shell__panel-resize"
          role="slider"
          tabindex="0"
          aria-orientation="horizontal"
          :aria-label="t('app.contextualWidth')"
          :aria-valuenow="layout.contextualWidth"
          :aria-valuemin="CONTEXTUAL_WIDTH_LIMITS.min"
          :aria-valuemax="CONTEXTUAL_WIDTH_LIMITS.max"
          @pointerdown="startContextualResize"
          @keydown.left.prevent="setContextualWidth(layout.contextualWidth + 8)"
          @keydown.right.prevent="setContextualWidth(layout.contextualWidth - 8)"
        />
        <header class="app-shell__panel-header">
          <span class="app-shell__panel-title">{{ contextPanelLabel }}</span>
          <button
            class="app-shell__panel-close"
            type="button"
            :aria-label="t('actions.closePanel')"
            :title="t('actions.closePanel')"
            @click="closeContextPanel"
          >
            <AppIcon name="close" :size="14" />
          </button>
        </header>
        <div class="app-shell__panel-body">
          <component
            :is="activeRightPanelComponent"
            v-bind="activeRightPanelProps"
            @reveal="revealOutlinePosition"
          />
        </div>
      </aside>
      <aside
        v-if="!activeRightPanel && compactRightPanels.length > 0 && !editorFocusChrome"
        class="app-shell__right-rail"
        :aria-label="t('app.rightSidebar')"
        :inert="overlayOpen"
      >
        <button
          v-for="panel in compactRightPanels"
          :key="panel.id"
          class="app-shell__right-rail-button"
          type="button"
          :title="panel.label"
          :aria-label="panel.label"
          @click="activateCompactRightPanel(panel.id)"
        >
          <AppIcon :name="panel.icon" :size="15" />
        </button>
      </aside>
    </div>

    <div class="app-shell__statusbar" :hidden="editorFocusChrome" :inert="editorFocusChrome">
      <Statusbar />
    </div>
    <ToastHost />
    <DialogHost />
  </div>
</template>

<style scoped lang="scss">
@use "../styles/colors" as *;
@use "../styles/controls" as *;
@use "../styles/variables" as *;

.app-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: $background;
}

.app-shell__chrome {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  flex-shrink: 0;
  background: $surface;
}

.app-shell__menu-row,
.app-shell__actions-row {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: $space-related $space-compact;
  border-bottom: 1px solid $border-subtle;
}

.app-shell__menu-row {
  min-height: $menu-row-height;
}

.app-shell__actions-row {
  min-height: $actions-row-height;
}

.app-shell__body {
  display: flex;
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.app-shell__statusbar {
  flex-shrink: 0;
}

.app-shell__scrim {
  display: none;
}

.app-shell__main {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 0;
  box-sizing: border-box;
}

.app-shell__stage {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: transparent;
}

.app-shell__page {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.app-shell__panel {
  position: relative;
  display: flex;
  flex: 0 0 var(--contextual-width, clamp(18rem, 30vw, 28rem));
  flex-direction: column;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  border-left: 1px solid $border-subtle;
  background: $surface;
}

.app-shell__panel-resize {
  position: absolute;
  top: 0;
  left: -6px;
  z-index: 2;
  width: $resize-hit-width;
  height: 100%;
  @include resize-handle-interaction;
}

.app-shell__panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $space-related;
  flex-shrink: 0;
  min-height: $panel-header-height;
  padding: $space-related $space-block;
  border-bottom: 1px solid $border-subtle;
}

.app-shell__panel-title {
  color: $text-muted;
  font-size: $font-caption;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.app-shell__panel-close {
  @include icon-action-button;
  color: $text-muted;
}

.app-shell__panel-body {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1;
  overflow: hidden;
  padding: 0;

  :deep(.page-shell) {
    width: 100%;
    height: 100%;
    padding: $space-related $space-compact $space-compact;
  }

  :deep(.inspector-panel) {
    width: 100%;
    height: 100%;
    border: 0;
  }
}

.app-shell__right-rail {
  display: flex;
  flex: 0 0 calc(#{$hit-min} + #{$space-2});
  flex-direction: column;
  align-items: center;
  gap: $space-tight;
  padding: $space-related 2px;
  border-left: 1px solid $border-subtle;
  background: $surface;
}

.app-shell__right-rail-button {
  @include icon-action-button;
  color: $text-muted;
}

@media (max-width: 900px) {
  .app-shell__panel {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    width: min(var(--contextual-width, 22rem), calc(100% - 3rem));
    max-width: calc(100% - 3rem);
    box-shadow: $shadow-soft;
  }

  .app-shell__scrim {
    position: absolute;
    inset: 0;
    z-index: 4;
    display: block;
    border: 0;
    background: $overlay;
    cursor: pointer;
  }

  .app-shell__scrim--left {
    z-index: 5;
  }

  .app-shell__panel {
    z-index: 6;
  }

  .app-sidebar {
    z-index: 7;
  }

  .app-shell__right-rail {
    flex-basis: 40px;
  }
}
</style>
