import type { ComponentPropsWithoutRef } from "react";

export type DiscHeaderProps = Omit<
  ComponentPropsWithoutRef<"div">,
  "children"
> & {
  discNumber: number;
};

export function DiscHeader({
  discNumber,
  className,
  ...props
}: DiscHeaderProps) {
  return (
    <div
      data-selection-ignore
      aria-hidden="true"
      {...props}
      className={`track-disc-header${className ? ` ${className}` : ""}`}
    >
      Диск {discNumber}
    </div>
  );
}
