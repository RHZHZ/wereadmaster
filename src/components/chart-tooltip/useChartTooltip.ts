import { useEffect, useRef, useState, type KeyboardEvent } from "react";

type ChartTooltipKey = number | string;

export function useChartTooltip<
  TKey extends ChartTooltipKey,
  TElement extends HTMLElement = HTMLDivElement
>() {
  const containerRef = useRef<TElement | null>(null);
  const [activeKey, setActiveKey] = useState<TKey | null>(null);
  const [pinnedKey, setPinnedKey] = useState<TKey | null>(null);

  useEffect(() => {
    if (pinnedKey === null) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && containerRef.current?.contains(event.target)) {
        return;
      }

      setActiveKey(null);
      setPinnedKey(null);
    };
    const handleScroll = () => {
      setActiveKey(null);
      setPinnedKey(null);
    };
    const scrollParents = resolveScrollParents(containerRef.current);

    window.addEventListener("pointerdown", handlePointerDown);
    scrollParents.forEach((parent) => {
      parent.addEventListener("scroll", handleScroll, { capture: true });
    });

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      scrollParents.forEach((parent) => {
        parent.removeEventListener("scroll", handleScroll, { capture: true });
      });
    };
  }, [pinnedKey]);

  const clearTooltip = () => {
    setActiveKey(null);
    setPinnedKey(null);
  };

  const getTriggerProps = (key: TKey, tooltipId?: string) => {
    const isActive = activeKey === key;
    const isPinned = pinnedKey === key;

    return {
      onMouseEnter: () => {
        if (pinnedKey !== null && pinnedKey !== key) {
          return;
        }

        setActiveKey(key);
      },
      onMouseLeave: () => {
        if (pinnedKey !== null) {
          return;
        }

        setActiveKey((current) => (current === key ? null : current));
      },
      onFocus: () => {
        if (pinnedKey !== null && pinnedKey !== key) {
          setPinnedKey(null);
        }

        setActiveKey(key);
      },
      onBlur: () => {
        if (pinnedKey !== null) {
          return;
        }

        setActiveKey((current) => (current === key ? null : current));
      },
      onClick: () => {
        if (pinnedKey === key) {
          clearTooltip();
          return;
        }

        setActiveKey(key);
        setPinnedKey(key);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Escape") {
          return;
        }

        clearTooltip();
        event.currentTarget.blur();
      },
      "aria-describedby": isActive && tooltipId ? tooltipId : undefined,
      "aria-pressed": isPinned,
      "data-tooltip-active": isActive ? "true" : undefined
    };
  };

  return {
    activeKey,
    clearTooltip,
    containerRef,
    getTriggerProps,
    isActive: (key: TKey) => activeKey === key,
    isPinned: (key: TKey) => pinnedKey === key
  };
}

function resolveScrollParents(element: HTMLElement | null): Array<HTMLElement | Window> {
  const parents: Array<HTMLElement | Window> = [window];

  let current = element?.parentElement ?? null;
  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const overflowX = style.overflowX;

    if (/(auto|scroll|overlay)/.test(`${overflowY} ${overflowX}`)) {
      parents.push(current);
    }

    current = current.parentElement;
  }

  return parents;
}
