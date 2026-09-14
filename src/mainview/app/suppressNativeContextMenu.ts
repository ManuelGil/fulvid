/**
 * Suppress the WebView/browser default context menu (Inspect Element, etc.).
 *
 * Electrobun 2.0.1 exposes no BrowserWindow/BrowserView option for this. The
 * documented path is canceling the page `contextmenu` default in the webview.
 * This listener only calls preventDefault — it does not own menus, stop
 * propagation, or replace Fulvid's ContextMenu.vue entry points.
 */
export function installNativeContextMenuSuppression(target: EventTarget = document): () => void {
  const onContextMenu = (event: Event): void => {
    event.preventDefault();
  };
  target.addEventListener("contextmenu", onContextMenu);
  return () => {
    target.removeEventListener("contextmenu", onContextMenu);
  };
}
