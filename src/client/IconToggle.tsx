import { type ReactNode } from "react";

export function IconToggle({
  checked,
  onCheckedChange,
  icon,
  offLabel,
  onLabel,
  disabled = false,
  className = "",
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  icon: ReactNode;
  offLabel: string;
  onLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const label = checked ? onLabel : offLabel;
  return (
    <button
      type="button"
      className={`icon-toggle ${checked ? "is-on" : "is-off"} ${className}`}
      aria-label={label}
      aria-pressed={checked}
      disabled={disabled}
      title={label}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="icon-toggle-thumb">{icon}</span>
    </button>
  );
}
