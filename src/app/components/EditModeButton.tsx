"use client";

type EditModeButtonProps = {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
};

export default function EditModeButton({
  active,
  onClick,
  disabled = false,
  className = "",
}: EditModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={active ? "Выключить редактирование" : "Включить редактирование"}
      title={active ? "Редактирование включено" : "Редактировать"}
      className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? "bg-amber-600 text-white hover:bg-amber-500" : "bg-slate-900 text-white hover:bg-slate-800"
      } ${className}`.trim()}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    </button>
  );
}
