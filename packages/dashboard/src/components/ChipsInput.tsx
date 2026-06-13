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
 * Multi-select with autocomplete and free-text fallback.
 *
 * The suggestion dropdown shows label-only entries from `options`
 * (filtered to ones whose `value` is not already in `values`). On
 * select, the option's `value` is appended to `values` — the label
 * is only ever a display concern. Free-text Enter is the escape
 * hatch for power users adding a value not represented in `options`
 * (e.g. a remote origin URI not in the local catalog); the typed
 * string is stored verbatim as the value.
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
  const [rect, setRect] = useState<SuggestRect | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const generatedInputId = useId();
  const inputId = inputIdProp ?? generatedInputId;
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
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue(text);
            } else if (e.key === "Backspace" && text === "" && values.length > 0) {
              remove(values[values.length - 1]!);
            } else if (e.key === "," && text.trim()) {
              e.preventDefault();
              addValue(text);
            } else if (e.key === "Escape") {
              setFocused(false);
            }
          }}
          placeholder={values.length === 0 ? placeholder : ""}
          disabled={disabled}
          autoComplete="off"
        />
      </div>
      {showDropdown &&
        createPortal(
          <div
            className="chips__suggest"
            style={{ left: rect.left, top: rect.top, width: rect.width }}
          >
            {suggestions.map((o) => (
              <button
                key={o.value}
                type="button"
                className="chips__suggest-item"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addValue(o.value);
                }}
              >
                <PlusIcon />
                <span>{o.label}</span>
              </button>
            ))}
          </div>,
          portalTarget,
        )}
    </div>
  );
}
