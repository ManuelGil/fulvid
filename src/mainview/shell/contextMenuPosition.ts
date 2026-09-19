export type MenuAnchor = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

type Size = {
  width: number;
  height: number;
};

export type MenuPlacement = "below" | "end" | "point";

const GAP = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function placeContextMenu(
  anchor: MenuAnchor,
  size: Size,
  viewport: Size,
  placement: MenuPlacement,
  margin = 8,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, viewport.width - size.width - margin);
  const maxTop = Math.max(margin, viewport.height - size.height - margin);

  if (placement === "point") {
    return {
      left: clamp(anchor.left, margin, maxLeft),
      top: clamp(anchor.top, margin, maxTop),
    };
  }

  if (placement === "below") {
    let top = anchor.bottom + GAP;
    const overflowBottom = top + size.height > viewport.height - margin;
    const flippedTop = anchor.top - size.height - GAP;
    if (overflowBottom && flippedTop >= margin) {
      top = flippedTop;
    }
    return {
      left: clamp(anchor.left, margin, maxLeft),
      top: clamp(top, margin, maxTop),
    };
  }

  const spaceEnd = viewport.width - anchor.right - margin;
  const spaceStart = anchor.left - margin;
  const openStart = spaceEnd < size.width && spaceStart >= size.width;
  const left = openStart ? anchor.left - size.width - GAP : anchor.right + GAP;
  return {
    left: clamp(left, margin, maxLeft),
    top: clamp(anchor.top, margin, maxTop),
  };
}
