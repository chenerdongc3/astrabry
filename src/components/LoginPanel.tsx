import { useState } from "react";
import { ShieldCheck, Mail, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { LangToggle } from "@/components/LangToggle";

export function LoginPanel() {
  const { login } = useAuth();
  const { toast } = useToast();
  const { t } = useLang();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login({ account, password });
      toast({
        title: t.loginSuccessTitle,
        description: t.loginSuccessDescription,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message === "AUTH_ACCOUNT_REQUIRED") {
        setError(t.accountRequired);
      } else if (message === "AUTH_PASSWORD_REQUIRED") {
        setError(t.passwordRequired);
      } else if (message === "AUTH_INVALID_CREDENTIALS") {
        setError(t.loginInvalidCredentials);
      } else {
        setError(t.loginUnknownError);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center px-4 py-10">
      <div className="surface-card w-full max-w-md rounded-xl p-6 shadow-lg space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">{t.loginTitle}</h1>
              <p className="text-sm text-muted-foreground">{t.loginSubtitle}</p>
            </div>
          </div>
          <LangToggle />
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="account" className="text-xs uppercase tracking-wide text-muted-foreground">
              {t.accountLabel}
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="account"
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="brilliantbryant"
                className="pl-9 h-10"
                autoComplete="username"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-xs uppercase tracking-wide text-muted-foreground">
              {t.passwordLabel}
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••"
                className="pl-9 h-10"
                autoComplete="current-password"
              />
            </div>
            <p className="text-[11px] text-muted-foreground font-mono-data">{t.passwordHint}</p>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full h-10 text-sm font-semibold tracking-wide"
            disabled={isSubmitting || !account || !password}
          >
            {isSubmitting ? t.loginSubmitting : t.loginCta}
          </Button>
        </form>
      </div>
    </div>
  );
}
