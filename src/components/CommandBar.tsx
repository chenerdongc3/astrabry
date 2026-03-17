import { useState, useRef } from "react";
import { Search, Play, Terminal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface CommandBarProps {
  onStartAgent: (url: string) => void;
  isRunning: boolean;
}

export function CommandBar({ onStartAgent, isRunning }: CommandBarProps) {
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim() && !isRunning) {
      onStartAgent(url.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="surface-card rounded-md p-1 flex items-center gap-2">
      <div className="flex items-center gap-2 px-3 text-muted-foreground">
        <Terminal className="h-4 w-4" />
        <span className="text-xs font-mono-data hidden sm:inline">astra&gt;</span>
      </div>
      <Input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Paste profile URL to begin analysis..."
        className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm placeholder:text-muted-foreground/60 h-9"
        disabled={isRunning}
      />
      <Button
        type="submit"
        size="sm"
        disabled={isRunning || !url.trim()}
        className="h-8 px-4 rounded-md text-xs font-medium gap-1.5"
      >
        <Play className="h-3 w-3" />
        {isRunning ? "Running..." : "Start Agent"}
      </Button>
    </form>
  );
}
