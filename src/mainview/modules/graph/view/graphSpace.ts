/**
 * Keep wheel and pinch gestures on the Sigma camera.
 * GraphCanvas is the owner; do not also bind this on GraphPage.
 */

const GESTURE_EVENTS = ["gesturestart", "gesturechange", "gestureend"] as const;

export function bindGraphSpaceIsolation(element: HTMLElement): () => void {
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
  };

  const onGesture = (event: Event): void => {
    event.preventDefault();
  };

  element.addEventListener("wheel", onWheel, { passive: false, capture: true });

  for (const name of GESTURE_EVENTS) {
    element.addEventListener(name, onGesture, { passive: false, capture: true });
  }

  return () => {
    element.removeEventListener("wheel", onWheel, { capture: true });
    for (const name of GESTURE_EVENTS) {
      element.removeEventListener(name, onGesture, { capture: true });
    }
  };
}
