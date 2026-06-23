import { useCallback, useRef } from "react";

export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly count?: number;
}

export interface SegmentedProps<V extends string> {
  readonly options: readonly SegmentedOption<V>[];
  readonly value: V;
  readonly onChange: (v: V) => void;
  readonly ariaLabel: string;
}

export function Segmented<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<V>) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentIndex = options.findIndex((o) => o.value === value);
      let nextIndex: number | null = null;

      switch (e.key) {
        case "ArrowRight":
          nextIndex = (currentIndex + 1) % options.length;
          break;
        case "ArrowLeft":
          nextIndex = (currentIndex - 1 + options.length) % options.length;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = options.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      const next = options[nextIndex]!;
      onChange(next.value);

      // Move focus to the newly active tab
      const container = containerRef.current;
      if (container) {
        const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons[nextIndex]?.focus();
      }
    },
    [options, value, onChange],
  );

  return (
    <div
      ref={containerRef}
      className="segmented"
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            className={`segmented__btn${isActive ? " segmented__btn--active" : ""}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.count !== undefined && <span className="segmented__count">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
