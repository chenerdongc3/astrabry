import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
const AUTH_STORAGE_KEY = "astrabry.auth.user";

const isAuthUser = (value: unknown): value is AuthUser => {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "email" in value &&
    typeof value.email === "string" &&
    "name" in value &&
    typeof value.name === "string"
  );
};

const readStoredUser = (): AuthUser | null => {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const storedValue = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!storedValue) {
      return null;
    }

    const parsedValue = JSON.parse(storedValue);
    if (isAuthUser(parsedValue)) {
      return parsedValue;
    }
  } catch {
    // Ignore malformed or unavailable storage and fall back to a signed-out state.
  }

  try {
    window.localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }

  return null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readStoredUser());

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      if (user) {
        window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
        return;
      }

      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    } catch {
      // Ignore storage write failures and keep the in-memory session working.
    }
  }, [user]);

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
