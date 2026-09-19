/**
 * Follow one pointer drag across the window: the resize handles of the
 * sidebar, Context panel, Inspector and Preview split.
 *
 * While it runs the body shows `cursor` and text cannot be selected. Release or
 * cancel ends it; the returned function ends it early (a new drag, unmount) and
 * does nothing once the drag is over.
 */
export function trackPointerDrag(
  cursor: string,
  onMove: (event: PointerEvent) => void,
): () => void {
  let active = true;
  const stop = (): void => {
    if (!active) {
      return;
    }
    active = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  return stop;
}
