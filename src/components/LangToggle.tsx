import { Languages } from "lucide-react";
import { useLang, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const OPTIONS: { value: Lang; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "zh", label: "中文" },
];

export function LangToggle() {
  const { lang, setLang } = useLang();

  return (
    <div className="flex items-center gap-2" aria-label="Language switcher">
      <Languages className="h-4 w-4 text-muted-foreground" aria-hidden />
      <div className="flex rounded-md border border-border bg-card p-0.5" role="group">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setLang(option.value)}
            className={cn(
              "px-2 py-1 text-[10px] font-mono-data uppercase tracking-wide transition-colors rounded-[4px]",
              lang === option.value
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={lang === option.value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
