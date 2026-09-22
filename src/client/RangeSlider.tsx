import { useRef, useState, type CSSProperties, type PointerEvent } from "react";

type CommonRangeSliderProps = {
  className?: string;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
};

type SingleRangeSliderProps = CommonRangeSliderProps & {
  variant?: "single";
  value: number;
  ariaLabel: string;
  onChange: (value: number) => void;
};

type DoubleRangeSliderProps = CommonRangeSliderProps & {
  variant: "double";
  values: readonly [minimum: number, maximum: number];
  ariaLabels: readonly [minimum: string, maximum: string];
  onChange: (values: readonly [minimum: number, maximum: number]) => void;
};

export type RangeSliderProps = SingleRangeSliderProps | DoubleRangeSliderProps;

function progress(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

export function RangeSlider(props: RangeSliderProps) {
  const [activeHandle, setActiveHandle] = useState<"minimum" | "maximum">(
    "maximum",
  );
  const [isSingleDragging, setIsSingleDragging] = useState(false);
  const [draggingHandle, setDraggingHandle] = useState<
    "minimum" | "maximum" | null
  >(null);
  const [hoveredHandle, setHoveredHandle] = useState<
    "minimum" | "maximum" | null
  >(null);
  const [isSliderHovered, setIsSliderHovered] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const valuesRef = useRef<readonly [minimum: number, maximum: number] | null>(
    null,
  );
  const className = `range-slider range-slider--${props.variant || "single"}${props.variant === "double" && isSliderHovered ? " is-hovered" : ""}${props.className ? ` ${props.className}` : ""}`;

  if (props.variant !== "double") {
    const end = 100 - progress(props.value, props.min, props.max);
    const valueAtPointer = (event: PointerEvent<HTMLElement>) => {
      const slider = sliderRef.current;
      if (!slider) return props.value;
      const rect = slider.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / rect.width),
      );
      return Math.min(
        props.max,
        Math.max(
          props.min,
          props.min +
            Math.round(((props.max - props.min) * ratio) / props.step) *
              props.step,
        ),
      );
    };
    const beginSingleDrag = (event: PointerEvent<HTMLSpanElement>) => {
      const slider = sliderRef.current;
      if (props.disabled || !slider) return;
      event.preventDefault();
      event.stopPropagation();
      slider.setPointerCapture(event.pointerId);
      setIsSingleDragging(true);
      props.onChange(valueAtPointer(event));
    };
    return (
      <div
        ref={sliderRef}
        className={className}
        style={
          { "--range-start": "0%", "--range-end": `${end}%` } as CSSProperties
        }
        onPointerMove={(event) => {
          if (
            !isSingleDragging ||
            !event.currentTarget.hasPointerCapture(event.pointerId)
          )
            return;
          props.onChange(valueAtPointer(event));
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          setIsSingleDragging(false);
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          setIsSingleDragging(false);
        }}
      >
        <input
          className="range-slider-input"
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          disabled={props.disabled}
          aria-label={props.ariaLabel}
          onChange={(event) => props.onChange(Number(event.target.value))}
        />
        <span
          className={`range-slider-thumb range-slider-thumb--single${isSingleDragging ? " is-dragging" : ""}`}
          style={
            {
              "--range-thumb-position": `${progress(props.value, props.min, props.max)}%`,
            } as CSSProperties
          }
          aria-hidden="true"
          onPointerDown={beginSingleDrag}
        />
      </div>
    );
  }

  const [minimum, maximum] = props.values;
  valuesRef.current = props.values;
  const valueAtPointer = (
    event: PointerEvent<HTMLElement>,
    slider: HTMLDivElement,
  ) => {
    const rect = slider.getBoundingClientRect();
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    const value = Math.min(
      props.max,
      Math.max(
        props.min,
        props.min +
          Math.round(((props.max - props.min) * ratio) / props.step) *
            props.step,
      ),
    );
    return value;
  };
  const updateHandle = (
    handle: "minimum" | "maximum",
    event: PointerEvent<HTMLElement>,
    slider: HTMLDivElement,
  ) => {
    const value = valueAtPointer(event, slider);
    const [currentMinimum, currentMaximum] = valuesRef.current || [
      minimum,
      maximum,
    ];
    if (handle === "minimum") {
      props.onChange([Math.min(value, currentMaximum), currentMaximum]);
    } else {
      props.onChange([currentMinimum, Math.max(value, currentMinimum)]);
    }
  };
  const beginDrag = (
    handle: "minimum" | "maximum",
    event: PointerEvent<HTMLElement>,
  ) => {
    const slider = sliderRef.current;
    if (props.disabled || !slider) return;
    event.preventDefault();
    event.stopPropagation();
    slider.setPointerCapture(event.pointerId);
    setActiveHandle(handle);
    setDraggingHandle(handle);
    updateHandle(handle, event, slider);
  };
  const moveNearestHandle = (event: PointerEvent<HTMLDivElement>) => {
    if (props.disabled || event.target !== event.currentTarget) return;
    const value = valueAtPointer(event, event.currentTarget);
    const [currentMinimum, currentMaximum] = valuesRef.current || [
      minimum,
      maximum,
    ];
    beginDrag(
      Math.abs(value - currentMinimum) <= Math.abs(value - currentMaximum)
        ? "minimum"
        : "maximum",
      event,
    );
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (
      !draggingHandle ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    )
      return;
    updateHandle(draggingHandle, event, event.currentTarget);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setDraggingHandle(null);
  };
  const thumbClass = (handle: "minimum" | "maximum") =>
    `range-slider-thumb range-slider-thumb--${handle} ${activeHandle === handle ? "active" : ""} ${hoveredHandle === handle ? "is-hovered" : ""} ${draggingHandle === handle ? "is-dragging" : ""}`;
  return (
    <div
      ref={sliderRef}
      className={className}
      style={
        {
          "--range-start": `${progress(minimum, props.min, props.max)}%`,
          "--range-end": `${100 - progress(maximum, props.min, props.max)}%`,
        } as CSSProperties
      }
      onPointerDown={moveNearestHandle}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => setIsSliderHovered(true)}
      onPointerLeave={() => setIsSliderHovered(false)}
    >
      <input
        className={`range-slider-input range-slider-input--minimum ${activeHandle === "minimum" ? "active" : ""}`}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={minimum}
        disabled={props.disabled}
        aria-label={props.ariaLabels[0]}
        onFocus={() => setActiveHandle("minimum")}
        onPointerDown={() => setActiveHandle("minimum")}
        onChange={(event) =>
          props.onChange([
            Math.min(Number(event.target.value), maximum),
            maximum,
          ])
        }
      />
      <input
        className={`range-slider-input range-slider-input--maximum ${activeHandle === "maximum" ? "active" : ""}`}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={maximum}
        disabled={props.disabled}
        aria-label={props.ariaLabels[1]}
        onFocus={() => setActiveHandle("maximum")}
        onPointerDown={() => setActiveHandle("maximum")}
        onChange={(event) =>
          props.onChange([
            minimum,
            Math.max(Number(event.target.value), minimum),
          ])
        }
      />
      <span
        className={thumbClass("minimum")}
        style={
          {
            "--range-thumb-position": `${progress(minimum, props.min, props.max)}%`,
          } as CSSProperties
        }
        aria-hidden="true"
        onPointerDown={(event) => beginDrag("minimum", event)}
        onPointerEnter={() => setHoveredHandle("minimum")}
        onPointerLeave={() => setHoveredHandle(null)}
      />
      <span
        className={thumbClass("maximum")}
        style={
          {
            "--range-thumb-position": `${progress(maximum, props.min, props.max)}%`,
          } as CSSProperties
        }
        aria-hidden="true"
        onPointerDown={(event) => beginDrag("maximum", event)}
        onPointerEnter={() => setHoveredHandle("maximum")}
        onPointerLeave={() => setHoveredHandle(null)}
      />
    </div>
  );
}
