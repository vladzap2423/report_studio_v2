"use client";

import {
  Children,
  type ChangeEvent,
  type FocusEventHandler,
  type KeyboardEvent,
  type ReactNode,
  type ReactElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

type AppSelectProps = {
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  id?: string;
  title?: string;
  autoFocus?: boolean;
  onBlur?: FocusEventHandler<HTMLButtonElement>;
  onFocus?: FocusEventHandler<HTMLButtonElement>;
  "aria-label"?: string;
  wrapperClassName?: string;
  selectClassName?: string;
  iconClassName?: string;
  children?: ReactNode;
};

type SelectOption = {
  value: string;
  label: string;
  disabled: boolean;
};

type MenuPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

function cls(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true">
      <path
        d="M4.25 6.25 8 10l3.75-3.75"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    return extractText(element.props.children);
  }
  return "";
}

function buildOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children)
    .filter((child) => isValidElement(child) && child.type === "option")
    .map((child) => {
      const option = child as ReactElement<{
        value?: string | number | readonly string[];
        disabled?: boolean;
        children?: ReactNode;
      }>;

      return {
        value: Array.isArray(option.props.value)
          ? String(option.props.value[0] ?? "")
          : String(option.props.value ?? ""),
        label: extractText(option.props.children).trim(),
        disabled: Boolean(option.props.disabled),
      };
    });
}

export default function AppSelect({
  wrapperClassName,
  selectClassName,
  iconClassName,
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  required,
  id,
  title,
  autoFocus,
  onBlur,
  onFocus,
  "aria-label": ariaLabel,
}: AppSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);

  const options = useMemo(() => buildOptions(children), [children]);
  const currentValue = value != null ? String(value) : defaultValue != null ? String(defaultValue) : "";
  const selectedOption =
    options.find((option) => option.value === currentValue) ??
    options.find((option) => option.value === "") ??
    options.find((option) => !option.disabled) ??
    options[0] ??
    null;

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !buttonRef.current) return;

    const updatePosition = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;
      const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, Math.min(288, openUp ? spaceAbove : spaceBelow));
      const top = openUp ? Math.max(12, rect.top - maxHeight - 8) : Math.min(viewportHeight - maxHeight - 12, rect.bottom + 8);

      setMenuPosition({
        left: rect.left,
        top,
        width: rect.width,
        maxHeight,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = options.findIndex((option) => option.value === selectedOption?.value);
    const selectedButton = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-option-index="${selectedIndex}"]`
    );
    selectedButton?.scrollIntoView({ block: "nearest" });
  }, [open, options, selectedOption?.value]);

  const emitChange = (nextValue: string) => {
    if (!onChange) return;
    const syntheticEvent = {
      target: { value: nextValue, name },
      currentTarget: { value: nextValue, name },
    } as ChangeEvent<HTMLSelectElement>;
    onChange(syntheticEvent);
  };

  const selectOption = (nextValue: string) => {
    if (disabled || nextValue === currentValue) {
      setOpen(false);
      return;
    }
    emitChange(nextValue);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const moveSelection = (direction: 1 | -1) => {
    const enabledOptions = options.filter((option) => !option.disabled);
    if (enabledOptions.length === 0) return;

    const currentIndex = enabledOptions.findIndex((option) => option.value === selectedOption?.value);
    const fallbackIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (fallbackIndex + direction + enabledOptions.length) % enabledOptions.length;
    selectOption(enabledOptions[nextIndex].value);
  };

  const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
    }
  };

  return (
    <div ref={rootRef} className={cls("relative inline-block overflow-visible rounded-2xl", wrapperClassName)}>
      <input type="hidden" name={name} value={selectedOption?.value ?? ""} />
      <button
        ref={buttonRef}
        id={id}
        type="button"
        title={title}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
        disabled={disabled}
        onBlur={onBlur}
        onFocus={onFocus}
        onClick={() => !disabled && setOpen((current) => !current)}
        onKeyDown={handleButtonKeyDown}
        className={cls(
          "h-full w-full rounded-[inherit] bg-transparent text-left outline-none",
          "disabled:cursor-not-allowed disabled:opacity-60",
          selectClassName
        )}
      >
        <span className="block truncate">{selectedOption?.label ?? ""}</span>
      </button>
      <span
        className={cls(
          "pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 transition-transform",
          open && "rotate-180",
          iconClassName
        )}
      >
        <ChevronIcon />
      </span>
      {open && !disabled && options.length > 0 && menuPosition
        ? createPortal(
            <div
              ref={listRef}
              role="listbox"
              aria-label={ariaLabel}
              className="fixed z-[120] overflow-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(15,23,42,0.16)]"
              style={{
                left: menuPosition.left,
                top: menuPosition.top,
                width: menuPosition.width,
                maxHeight: menuPosition.maxHeight,
              }}
            >
              {options.map((option, index) => {
                const active = option.value === selectedOption?.value;
                return (
                  <button
                    key={`${option.value}-${index}`}
                    type="button"
                    role="option"
                    data-option-index={index}
                    aria-selected={active}
                    disabled={option.disabled}
                    onClick={() => selectOption(option.value)}
                    className={cls(
                      "flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition",
                      option.disabled
                        ? "cursor-not-allowed text-slate-300"
                        : active
                          ? "bg-slate-900 text-white"
                          : "text-slate-700 hover:bg-slate-100"
                    )}
                  >
                    <span className="min-w-0 truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
