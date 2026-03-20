import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface AuthUser {
  email: string;
  name: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (credentials: { email: string; password: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const login: AuthContextValue["login"] = async ({ email, password }) => {
    await new Promise((resolve) => setTimeout(resolve, 600));

    if (!email.trim()) {
      throw new Error("Email is required");
    }
    if (!password.trim()) {
      throw new Error("Password is required");
    }
    if (password.length < 4) {
      throw new Error("Password must be at least 4 characters");
    }

    const displayName = email.split("@")[0] || "Agent";
    setUser({ email, name: displayName });
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
