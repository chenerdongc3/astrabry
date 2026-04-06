import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "@/lib/auth";

const AUTH_STORAGE_KEY = "astrabry.auth.user";

function AuthHarness() {
  const { user, login, logout } = useAuth();

  return (
    <div>
      <div data-testid="auth-user">{user ? `${user.name}|${user.email}` : "anonymous"}</div>
      <button
        type="button"
        onClick={() => {
          void login({ account: "brilliantbryant", password: "good123456" });
        }}
      >
        login
      </button>
      <button type="button" onClick={logout}>
        logout
      </button>
    </div>
  );
}

describe("AuthProvider persistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it("hydrates an existing user from localStorage on first render", () => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        name: "Persisted User",
        email: "persisted@example.com",
      }),
    );

    act(() => {
      root.render(
        <AuthProvider>
          <AuthHarness />
        </AuthProvider>,
      );
    });

    expect(container.querySelector("[data-testid='auth-user']")?.textContent).toBe(
      "Persisted User|persisted@example.com",
    );
  });

  it("persists login state and clears it again on logout", async () => {
    act(() => {
      root.render(
        <AuthProvider>
          <AuthHarness />
        </AuthProvider>,
      );
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(container.querySelector("[data-testid='auth-user']")?.textContent).toBe(
      "brilliantbryant|brilliantbryant",
    );
    expect(JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) ?? "null")).toEqual({
      name: "brilliantbryant",
      email: "brilliantbryant",
    });

    act(() => {
      container.querySelectorAll<HTMLButtonElement>("button")[1]?.click();
    });

    expect(container.querySelector("[data-testid='auth-user']")?.textContent).toBe("anonymous");
    expect(window.localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });
});
