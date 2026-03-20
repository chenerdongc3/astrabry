import { useState, useRef } from "react";
import { Play, Terminal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";

interface CommandBarProps {
  onStartAgent: (url: string) => void;
  isRunning: boolean;
}

export function CommandBar({ onStartAgent, isRunning }: CommandBarProps) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useLang();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isRunning) {
      onStartAgent(url.trim());
      setUrl("");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="surface-card rounded-xl p-1.5 flex items-center gap-2 w-full border-primary/20 shadow-[0_0_0_1px_rgba(20,217,235,0.08)]"
    >
      <div className="flex items-center gap-2 px-3 text-muted-foreground">
        <Terminal className="h-4 w-4" />
        <span className="text-xs font-mono-data hidden sm:inline">astra&gt;</span>
      </div>
      <Input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder={t.pasteUrl}
        className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm placeholder:text-muted-foreground/70 h-10"
        disabled={isRunning}
      />
      <Button
        type="submit"
        size="sm"
        disabled={isRunning || !url.trim()}
        className="h-9 px-4 rounded-lg text-xs font-semibold gap-1.5 bg-primary/90 hover:bg-primary text-primary-foreground"
      >
        <Play className="h-3 w-3" />
        {isRunning ? t.running : t.startAgent}
      </Button>
    </form>
  );
}
