import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseIcon, PlusIcon } from "./Icons";

/**
 * One selectable item in the dropdown. `value` is what gets stored in
 * `values`; `label` is what the user sees in the chip + dropdown row.
 *
 * For form inputs where the stored shape is opaque (e.g. dep origin
 * URIs while the user only recognises FQNs), the label/value split
 * lets the chip carry the human-friendly text while the form holds
 * the wire-shaped data. For the simpler case (single-token entries
 * where label === value), pass `{ value: v, label: v }`.
 */
export interface ChipsInputOption {
  readonly value: string;
  readonly label: string;
}

interface ChipsInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: readonly ChipsInputOption[];
  placeholder?: string;
  disabled?: boolean;
  emptyText?: string;
  /** Values to render as "missing" (red) — typically deps that don't exist in the catalog. */
  invalidValues?: readonly string[];
  /** id to apply to the underlying text input so an external <label htmlFor> can target it. */
  inputId?: string;
}

interface SuggestRect {
  left: number;
  top: number;
  width: number;
}

/**
 * Multi-select with autocomplete and free-text fallback, implemented
 * to the WAI-ARIA 1.2 combobox-with-listbox-popup pattern.
 *
 * The suggestion dropdown shows label-only entries from `options`
 * (filtered to ones whose `value` is not already in `values`). On
 * select, the option's `value` is appended to `values` — the label
 * is only ever a display concern.
 *
 * Keyboard model:
 *   - ArrowDown / ArrowUp: move the active suggestion (opens the
 *     dropdown if it was closed, wraps at both ends).
 *   - Home / End: jump to the first / last suggestion.
 *   - Enter with an active suggestion: commit that suggestion's
 *     `value`. Enter with no active suggestion but with text that
 *     exactly matches an option's label: commit that option's `value`
 *     (so typing the FQN and pressing Enter behaves the same as
 *     picking the row). Enter with text that doesn't match any
 *     option: free-text-commit the typed string verbatim — the
 *     escape hatch for power users adding a value the local catalog
 *     doesn't know about (e.g. a remote origin URI).
 *   - Backspace on empty input: remove the trailing chip.
 *   - Comma: same as Enter (matches the legacy comma-to-commit
 *     ergonomic for free-text lists).
 *   - Escape: close the dropdown without committing.
 *   - Tab: focus leaves the input → the dropdown closes (mouse-down
 *     commits already register before the blur, so this only matters
 *     when the user genuinely Tab-traverses away).
 *
 * The suggestion dropdown is rendered via a portal so it can escape ancestor
 * `overflow: hidden` containers (e.g. a modal body that scrolls). It uses
 * `position: fixed` with viewport coordinates computed from the input's
 * bounding rect, and the portal target is the nearest <dialog> ancestor (if
 * any) so we stay inside the browser's native top-layer when the chips live
 * inside a modal — otherwise document.body covers the dialog visually.
 */
export function ChipsInput({
  values,
  onChange,
  options,
  placeholder,
  disabled,
  emptyText,
  invalidValues,
  inputId: inputIdProp,
}: ChipsInputProps) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rect, setRect] = useState<SuggestRect | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const generatedInputId = useId();
  const inputId = inputIdProp ?? generatedInputId;
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Display lookup: stored value → user-facing label. Values added via
  // free-text (not present in `options`) fall back to their raw form
  // — the chip still renders, typically alongside an `invalidValues`
  // red-highlight so the user sees it's not catalog-resolved.
  const labelOf = (value: string): string => {
    for (const o of options) {
      if (o.value === value) return o.label;
    }
    return value;
  };

  const addValue = (value: string) => {
    const v = value.trim();
    if (!v) return;
    if (values.includes(v)) return;
    onChange([...values, v]);
    setText("");
  };

  const remove = (v: string) => {
    onChange(values.filter((x) => x !== v));
  };

  const lowered = text.toLowerCase();
  const suggestions = options
    .filter((o) => !values.includes(o.value))
    .filter((o) => o.label.toLowerCase().includes(lowered))
    .slice(0, 8);

  // Keep the active index in-bounds as the filtered list changes
  // beneath it (typing narrows the suggestions; selecting one shifts
  // them up by one).
  useEffect(() => {
    if (suggestions.length === 0) {
      if (activeIndex !== -1) setActiveIndex(-1);
      return;
    }
    if (activeIndex >= suggestions.length) {
      setActiveIndex(suggestions.length - 1);
    }
  }, [suggestions.length, activeIndex]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rect updates whenever focus / values change
  useLayoutEffect(() => {
    if (!focused) return;
    // Resolve the portal target: the nearest <dialog> ancestor or document.body.
    const target = containerRef.current?.closest("dialog") ?? document.body;
    setPortalTarget(target as HTMLElement);

    const update = () => {
      const r = containerRef.current?.getBoundingClientRect();
      if (!r) return;
      setRect({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [focused, values.length, text]);

  useEffect(() => {
    if (!focused) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [focused]);

  const showDropdown = focused && suggestions.length > 0 && rect && portalTarget;
  const optionId = (idx: number) => `${listboxId}-opt-${idx}`;
  const activeOptionId = showDropdown && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  // Enter / comma: if an option row is highlighted, commit it; else
  // if the typed text exactly matches an option's label, commit that
  // option's value (the "typed the FQN, pressed Enter" path that
  // would otherwise re-introduce the FQN-vs-origin-URI wire-shape
  // bug). Else fall back to the raw text as the free-text escape
  // hatch.
  const commitFromInput = () => {
    if (activeIndex >= 0 && activeIndex < suggestions.length) {
      addValue(suggestions[activeIndex]!.value);
      setActiveIndex(-1);
      return;
    }
    const trimmed = text.trim();
    if (trimmed === "") return;
    const lower = trimmed.toLowerCase();
    const exact = options.find((o) => o.label.toLowerCase() === lower && !values.includes(o.value));
    if (exact) {
      addValue(exact.value);
      return;
    }
    addValue(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      if (!focused) setFocused(true);
      setActiveIndex((i) => (i + 1 >= suggestions.length ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      if (suggestions.length === 0) return;
      e.preventDefault();
      if (!focused) setFocused(true);
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Home" && suggestions.length > 0 && activeIndex !== -1) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End" && suggestions.length > 0 && activeIndex !== -1) {
      e.preventDefault();
      setActiveIndex(suggestions.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitFromInput();
    } else if (e.key === "Backspace" && text === "" && values.length > 0) {
      remove(values[values.length - 1]!);
    } else if (e.key === "," && text.trim()) {
      e.preventDefault();
      commitFromInput();
    } else if (e.key === "Escape") {
      setFocused(false);
      setActiveIndex(-1);
    }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    // Tab-out / clicking somewhere outside the chips control closes
    // the dropdown. We check `relatedTarget` so a click on a
    // suggestion row (which fires mousedown → addValue *before* blur
    // is dispatched) doesn't double-fire by also closing the panel
    // before the value commits.
    const next = e.relatedTarget as Node | null;
    if (next && containerRef.current?.contains(next)) return;
    setFocused(false);
    setActiveIndex(-1);
  };

  return (
    <div className="chips" ref={containerRef}>
      <div className="chips__row">
        {values.length === 0 && !text && emptyText && (
          <span className="chips__empty">{emptyText}</span>
        )}
        {values.map((v) => {
          const isInvalid = invalidValues?.includes(v) ?? false;
          const label = labelOf(v);
          return (
            <span
              key={v}
              className={`chips__chip${isInvalid ? " chips__chip--invalid" : ""}`}
              title={isInvalid ? `Missing: not found in catalog` : v}
            >
              <span className="chips__chip-text">{label}</span>
              {!disabled && (
                <button
                  type="button"
                  className="chips__chip-remove"
                  onClick={() => remove(v)}
                  aria-label={`Remove ${label}`}
                >
                  <CloseIcon />
                </button>
              )}
            </span>
          );
        })}
        <input
          id={inputId}
          type="text"
          className="chips__input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            // Typing reshapes the suggestion list; reset the active
            // index so the user's next ArrowDown starts at the top of
            // the freshly-filtered set instead of preserving stale
            // highlight state.
            setActiveIndex(-1);
          }}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={values.length === 0 ? placeholder : ""}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={listboxId}
          aria-expanded={showDropdown ? true : false}
          {...(activeOptionId !== undefined ? { "aria-activedescendant": activeOptionId } : {})}
        />
      </div>
      {showDropdown &&
        createPortal(
          <div
            className="chips__suggest"
            style={{ left: rect.left, top: rect.top, width: rect.width }}
            role="listbox"
            id={listboxId}
          >
            {suggestions.map((o, idx) => {
              const isActive = idx === activeIndex;
              return (
                <button
                  key={o.value}
                  type="button"
                  id={optionId(idx)}
                  role="option"
                  aria-selected={isActive}
                  className={`chips__suggest-item${isActive ? " chips__suggest-item--active" : ""}`}
                  onMouseDown={(e) => {
                    // Use mousedown so the value commits before the
                    // input's blur fires (blur would otherwise close
                    // the dropdown and swallow the click).
                    e.preventDefault();
                    addValue(o.value);
                    setActiveIndex(-1);
                  }}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  <PlusIcon />
                  <span>{o.label}</span>
                </button>
              );
            })}
          </div>,
          portalTarget,
        )}
    </div>
  );
}
