#!/usr/bin/env node

const { chromium } = require("playwright");

const RESULT_PREFIX = "XHS_LOGIN_SYNC_RESULT=";
const DEFAULT_TIMEOUT_SECONDS = 180;

const parseTimeoutSeconds = () => {
  const raw = process.argv[2];
  const parsed = Number.parseInt(raw || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_TIMEOUT_SECONDS;
};

const buildCookieHeader = (cookies) =>
  cookies
    .filter((cookie) => typeof cookie.name === "string" && typeof cookie.value === "string")
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

const cookiesToMap = (cookies) => {
  const map = {};
  for (const cookie of cookies) {
    if (!cookie || typeof cookie.name !== "string" || typeof cookie.value !== "string") {
      continue;
    }
    if (!cookie.name.trim() || !cookie.value.trim()) {
      continue;
    }
    map[cookie.name.trim()] = cookie.value.trim();
  }
  return map;
};

const hasValidXhsSession = (cookieMap) => {
  const hasA1 = Boolean(cookieMap.a1);
  const hasWebSession = Boolean(cookieMap.web_session || cookieMap.web_session_id || cookieMap.web_session_v2);
  return hasA1 && hasWebSession;
};

const main = async () => {
  const timeoutSeconds = parseTimeoutSeconds();
  const deadline = Date.now() + timeoutSeconds * 1000;

  const browser = await chromium.launch({
    headless: false,
  });
  const context = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1360, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    await page.goto("https://www.xiaohongshu.com", { waitUntil: "domcontentloaded", timeout: 60000 });
    console.error("[xhs-playwright-sync] Browser opened. Please scan the QR code and complete login.");

    let snapshot = null;
    while (Date.now() < deadline) {
      const cookies = await context.cookies([
        "https://www.xiaohongshu.com",
        "https://edith.xiaohongshu.com",
      ]);
      const cookieMap = cookiesToMap(cookies);
      if (hasValidXhsSession(cookieMap)) {
        snapshot = {
          cookie_header: buildCookieHeader(cookies),
          cookies: cookieMap,
          updated_at: new Date().toISOString(),
        };
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!snapshot) {
      throw new Error("Login was not detected before timeout. Please retry and scan earlier.");
    }

    process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(snapshot)}\n`);
  } finally {
    await context.close();
    await browser.close();
  }
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[xhs-playwright-sync] ${message}`);
  process.exit(1);
});
