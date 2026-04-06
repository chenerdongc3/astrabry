import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

import { CommandBar } from "@/components/CommandBar";
import { LangProvider } from "@/lib/i18n";

describe("CommandBar Xiaohongshu validation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderBar = (onStartAgent = vi.fn()) => {
    act(() => {
      root.render(
        <LangProvider>
          <CommandBar
            onStartAgent={onStartAgent}
            isBusy={false}
            workflowState="idle"
            statusLabel="ready"
          />
        </LangProvider>,
      );
    });
    return onStartAgent;
  };

  const setInputValue = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="粘贴个人主页链接以开始分析..."]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      if (input) {
        Simulate.change(input, { target: { value } });
      }
    });
  };

  const clickSubmit = async () => {
    const form = container.querySelector<HTMLFormElement>("form");
    expect(form).not.toBeNull();
    await act(async () => {
      if (form) {
        Simulate.submit(form);
      }
    });
  };

  it("rejects non-Xiaohongshu URLs before starting ingest", async () => {
    const onStartAgent = renderBar();

    await setInputValue("https://example.com/not-supported");
    await clickSubmit();

    expect(onStartAgent).not.toHaveBeenCalled();
    expect(container.textContent).toContain("仅支持粘贴小红书主页或笔记链接。");
  });

  it("accepts Xiaohongshu profile URLs", async () => {
    const onStartAgent = renderBar();

    await setInputValue("https://www.xiaohongshu.com/user/profile/demo");
    await clickSubmit();

    expect(onStartAgent).toHaveBeenCalledWith("https://www.xiaohongshu.com/user/profile/demo");
  });
});
