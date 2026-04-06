import type { MonitoredAccount } from "./data";

export const ACCOUNT_CLICK_ORDER_STORAGE_KEY = "astrabry.xhs.account-click-order";

type AccountClickTimestamps = Record<string, number>;

const isValidTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

export const parseAccountClickTimestamps = (raw: string | null): AccountClickTimestamps => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    const timestamps: AccountClickTimestamps = {};
    for (const [accountId, value] of Object.entries(parsed)) {
      if (isValidTimestamp(value)) {
        timestamps[accountId] = value;
      }
    }
    return timestamps;
  } catch {
    return {};
  }
};

export const readAccountClickTimestamps = (): AccountClickTimestamps => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    return parseAccountClickTimestamps(window.localStorage.getItem(ACCOUNT_CLICK_ORDER_STORAGE_KEY));
  } catch {
    return {};
  }
};

export const writeAccountClickTimestamps = (timestamps: AccountClickTimestamps): void => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (Object.keys(timestamps).length === 0) {
      window.localStorage.removeItem(ACCOUNT_CLICK_ORDER_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(ACCOUNT_CLICK_ORDER_STORAGE_KEY, JSON.stringify(timestamps));
  } catch {
    // Keep account selection functional even when storage is unavailable.
  }
};

export const recordAccountClick = (
  timestamps: AccountClickTimestamps,
  accountId: string,
  clickedAt: number = Date.now(),
): AccountClickTimestamps => {
  if (!accountId) {
    return timestamps;
  }
  if (timestamps[accountId] === clickedAt) {
    return timestamps;
  }

  return {
    ...timestamps,
    [accountId]: clickedAt,
  };
};

export const pruneAccountClickTimestamps = (
  timestamps: AccountClickTimestamps,
  accounts: MonitoredAccount[],
): AccountClickTimestamps => {
  if (Object.keys(timestamps).length === 0) {
    return timestamps;
  }

  const validAccountIds = new Set(accounts.map((account) => account.id));
  let changed = false;
  const next: AccountClickTimestamps = {};

  for (const [accountId, timestamp] of Object.entries(timestamps)) {
    if (validAccountIds.has(accountId)) {
      next[accountId] = timestamp;
      continue;
    }
    changed = true;
  }

  return changed ? next : timestamps;
};

export const sortAccountsByClickTime = (
  accounts: MonitoredAccount[],
  timestamps: AccountClickTimestamps,
): MonitoredAccount[] =>
  [...accounts]
    .map((account, index) => ({
      account,
      index,
      clickedAt: timestamps[account.id] ?? 0,
    }))
    .sort((left, right) => {
      if (left.clickedAt === right.clickedAt) {
        return left.index - right.index;
      }
      return right.clickedAt - left.clickedAt;
    })
    .map(({ account }) => account);

