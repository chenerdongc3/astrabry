import { beforeEach, describe, expect, it } from "vitest";

import {
  ACCOUNT_CLICK_ORDER_STORAGE_KEY,
  parseAccountClickTimestamps,
  pruneAccountClickTimestamps,
  readAccountClickTimestamps,
  recordAccountClick,
  sortAccountsByClickTime,
  writeAccountClickTimestamps,
} from "@/lib/accountClickOrder";
import type { MonitoredAccount } from "@/lib/data";

const ACCOUNT_FIXTURES: MonitoredAccount[] = [
  {
    id: "acc-1",
    name: "Creator 1",
    xhsId: "creator_1",
    platform: "xiaohongshu",
    avatar: "1",
    postCount: 1,
  },
  {
    id: "acc-2",
    name: "Creator 2",
    xhsId: "creator_2",
    platform: "xiaohongshu",
    avatar: "2",
    postCount: 2,
  },
  {
    id: "acc-3",
    name: "Creator 3",
    xhsId: "creator_3",
    platform: "xiaohongshu",
    avatar: "3",
    postCount: 3,
  },
];

describe("account click order", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("sorts clicked accounts by latest click time first", () => {
    const ordered = sortAccountsByClickTime(ACCOUNT_FIXTURES, {
      "acc-1": 100,
      "acc-3": 300,
      "acc-2": 200,
    });

    expect(ordered.map((account) => account.id)).toEqual(["acc-3", "acc-2", "acc-1"]);
  });

  it("keeps untouched accounts in their original relative order", () => {
    const ordered = sortAccountsByClickTime(ACCOUNT_FIXTURES, {
      "acc-3": 500,
    });

    expect(ordered.map((account) => account.id)).toEqual(["acc-3", "acc-1", "acc-2"]);
  });

  it("stores and restores click timestamps from localStorage", () => {
    writeAccountClickTimestamps({ "acc-1": 111, "acc-2": 222 });

    expect(readAccountClickTimestamps()).toEqual({ "acc-1": 111, "acc-2": 222 });
  });

  it("parses malformed storage payloads safely", () => {
    window.localStorage.setItem(ACCOUNT_CLICK_ORDER_STORAGE_KEY, "not-json");
    expect(readAccountClickTimestamps()).toEqual({});

    window.localStorage.setItem(
      ACCOUNT_CLICK_ORDER_STORAGE_KEY,
      JSON.stringify({ "acc-1": "invalid", "acc-2": 42, "acc-3": -1 }),
    );
    expect(parseAccountClickTimestamps(window.localStorage.getItem(ACCOUNT_CLICK_ORDER_STORAGE_KEY))).toEqual({
      "acc-2": 42,
    });
  });

  it("prunes timestamps that no longer exist in account cache", () => {
    const previous = { "acc-1": 10, "acc-removed": 20 };

    const next = pruneAccountClickTimestamps(previous, ACCOUNT_FIXTURES);
    expect(next).toEqual({ "acc-1": 10 });
  });

  it("records click time immutably", () => {
    const previous = { "acc-1": 10 };
    const next = recordAccountClick(previous, "acc-2", 200);

    expect(previous).toEqual({ "acc-1": 10 });
    expect(next).toEqual({ "acc-1": 10, "acc-2": 200 });
  });
});

