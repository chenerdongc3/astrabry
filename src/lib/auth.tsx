import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface AuthUser {
  email: string;
  name: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (credentials: { account: string; password: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TEST_ACCOUNT = "brilliantbryant";
const TEST_PASSWORD = "good123456";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const login: AuthContextValue["login"] = async ({ account, password }) => {
    await new Promise((resolve) => setTimeout(resolve, 600));

    const normalizedAccount = account.trim();
    if (!normalizedAccount) {
      throw new Error("AUTH_ACCOUNT_REQUIRED");
    }
    if (!password.trim()) {
      throw new Error("AUTH_PASSWORD_REQUIRED");
    }
    if (normalizedAccount !== TEST_ACCOUNT || password !== TEST_PASSWORD) {
      throw new Error("AUTH_INVALID_CREDENTIALS");
    }

    setUser({ email: normalizedAccount, name: normalizedAccount });
  };

  const logout = () => setUser(null);

  const value = useMemo(() => ({ user, login, logout }), [user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
