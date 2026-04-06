import type { ComponentPropsWithoutRef } from "react";

type AppSelectProps = ComponentPropsWithoutRef<"select"> & {
  wrapperClassName?: string;
  selectClassName?: string;
  iconClassName?: string;
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

export default function AppSelect({
  wrapperClassName,
  selectClassName,
  iconClassName,
  children,
  ...props
}: AppSelectProps) {
  return (
    <div className={cls("relative inline-block overflow-hidden rounded-2xl", wrapperClassName)}>
      <select
        {...props}
        className={cls(
          "h-full w-full appearance-none rounded-[inherit] bg-transparent outline-none",
          selectClassName
        )}
      >
        {children}
      </select>
      <span
        className={cls(
          "pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400",
          iconClassName
        )}
      >
        <ChevronIcon />
      </span>
    </div>
  );
}
