import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
} from "react";
import { X } from "lucide-react";

type AppliedOption = { value: string; caret: number };

export function AutocompleteInput({
  value,
  onValueChange,
  options,
  getQuery = (current) => current,
  applyOption = (option) => ({ value: option, caret: option.length }),
  loading = false,
  emptyMessage = "Ничего не найдено",
  clearLabel = "Очистить значение",
  className,
  ...inputProps
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "className"
> & {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  getQuery?: (value: string, caret: number) => string;
  applyOption?: (option: string, value: string, caret: number) => AppliedOption;
  loading?: boolean;
  emptyMessage?: string;
  clearLabel?: string;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [caret, setCaret] = useState(value.length);
  const [activeIndex, setActiveIndex] = useState(-1);
  const query = getQuery(value, caret).trim();
  const suggestions = useMemo(() => {
    const normalized = query.toLocaleLowerCase();
    return options.filter((option) =>
      option.toLocaleLowerCase().includes(normalized),
    );
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query, options]);
  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  const syncCaret = (nextCaret: number | null) =>
    setCaret(nextCaret ?? value.length);
  const selectOption = (option: string) => {
    const applied = applyOption(option, value, caret);
    onValueChange(applied.value);
    setOpen(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(applied.caret, applied.caret);
      setCaret(applied.caret);
    });
  };
  const clear = () => {
    onValueChange("");
    setOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      setCaret(0);
    });
  };

  return (
    <div className="autocomplete-input" ref={rootRef}>
      <input
        {...inputProps}
        ref={inputRef}
        className={className}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-activedescendant={
          open && suggestions[activeIndex]
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        onFocus={(event) => {
          syncCaret(event.currentTarget.selectionStart);
          setOpen(true);
          inputProps.onFocus?.(event);
        }}
        onSelect={(event) => {
          syncCaret(event.currentTarget.selectionStart);
          inputProps.onSelect?.(event);
        }}
        onChange={(event) => {
          onValueChange(event.target.value);
          syncCaret(event.target.selectionStart);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) =>
              Math.min(index + 1, suggestions.length - 1),
            );
          } else if (event.key === "ArrowUp" && suggestions.length) {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) =>
              index < 0 ? suggestions.length - 1 : Math.max(index - 1, 0),
            );
          } else if (
            event.key === "Enter" &&
            open &&
            suggestions.length
          ) {
            event.preventDefault();
            selectOption(suggestions[Math.max(activeIndex, 0)]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setOpen(false);
          } else if (event.key === "Tab") {
            setOpen(false);
          }
          inputProps.onKeyDown?.(event);
        }}
      />
      {value && (
        <button
          type="button"
          className="autocomplete-clear"
          aria-label={clearLabel}
          title="Очистить"
          onClick={clear}
        >
          <X size={15} aria-hidden="true" />
        </button>
      )}
      {open && (
        <div className="autocomplete-menu" id={listboxId} role="listbox">
          {loading ? (
            <div className="autocomplete-empty" role="status">
              Загружаем варианты…
            </div>
          ) : suggestions.length ? (
            suggestions.map((option, index) => (
              <div
                className={`autocomplete-option ${index === activeIndex ? "active" : ""}`}
                id={`${listboxId}-option-${index}`}
                key={option}
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectOption(option);
                }}
              >
                {option}
              </div>
            ))
          ) : (
            <div className="autocomplete-empty" role="status">
              {emptyMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
