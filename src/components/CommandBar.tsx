import { useState } from "react";
import { Play, Terminal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { isSupportedXhsUrl, type XhsWorkflowState } from "@/lib/xhsAuthRequired";

interface CommandBarProps {
  onStartAgent: (url: string) => void;
  isBusy: boolean;
  workflowState: XhsWorkflowState;
  statusLabel?: string;
  externalError?: string | null;
}

export function CommandBar({
  onStartAgent,
  isBusy,
  workflowState,
  statusLabel,
  externalError,
}: CommandBarProps) {
  const [url, setUrl] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const { t } = useLang();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextUrl = url.trim();
    if (!nextUrl || isBusy) {
      return;
    }

    if (!isSupportedXhsUrl(nextUrl)) {
      setInputError(t.xhsUrlInvalid);
      return;
    }

    setInputError(null);
    onStartAgent(nextUrl);
    setUrl("");
  };

  const footerMessage = inputError || externalError || statusLabel;
  const footerTone =
    inputError || workflowState === "error"
      ? "text-anomaly"
      : workflowState === "awaiting_auth"
        ? "text-primary"
        : "text-muted-foreground";

  return (
    <div className="space-y-2">
      <form
        onSubmit={handleSubmit}
        className="surface-card rounded-xl p-1.5 flex items-center gap-2 w-full border-primary/20 shadow-[0_0_0_1px_rgba(20,217,235,0.08)]"
      >
        <div className="flex items-center gap-2 px-3 text-muted-foreground">
          <Terminal className="h-4 w-4" />
          <span className="text-xs font-mono-data hidden sm:inline">astra&gt;</span>
        </div>
        <Input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (inputError) {
              setInputError(null);
            }
          }}
          placeholder={t.pasteUrl}
          className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm placeholder:text-muted-foreground/70 h-10"
          disabled={isBusy}
          aria-invalid={Boolean(inputError)}
        />
        <Button
          type="submit"
          size="sm"
          disabled={isBusy || !url.trim()}
          className="h-9 px-4 rounded-lg text-xs font-semibold gap-1.5 bg-primary/90 hover:bg-primary text-primary-foreground"
        >
          <Play className="h-3 w-3" />
          {isBusy ? t.running : t.startAgent}
        </Button>
      </form>
      {footerMessage ? (
        <p className={`px-1 text-xs ${footerTone}`}>{footerMessage}</p>
      ) : null}
    </div>
  );
}
