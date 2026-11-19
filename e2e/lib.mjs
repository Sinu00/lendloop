// Shared helpers for the browser end-to-end run (e2e/flow.mjs).
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import crypto from "node:crypto";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const SHOTS = process.env.SHOTS_DIR ?? path.join(ROOT, "e2e", "screenshots");
mkdirSync(SHOTS, { recursive: true });

/** Starts `next start` (run `npm run build` first) unless BASE_URL points at an app that is already running. */
export async function startServer() {
  // "up" means LendLoop answers, not just anything on that port.
  const probe = async () => {
    try { const r = await fetch(BASE_URL); return r.ok ? ((await r.text()).includes("LendLoop") ? "lendloop" : "other") : "down"; }
    catch { return "down"; }
  };
  const first = await probe();
  if (first === "lendloop") return { kill() {} };
  if (first === "other") throw new Error(`${BASE_URL} is serving a different app. Free the port or set BASE_URL=http://localhost:3100`);
  const port = new URL(BASE_URL).port || "3000";
  const p = spawn("npx", ["next", "start", "-p", port], { cwd: ROOT, stdio: "ignore" });
  for (let i = 0; i < 60 && (await probe()) !== "lendloop"; i++) await new Promise((r) => setTimeout(r, 500));
  return p;
}

/** Uses the installed Google Chrome, or CHROME_PATH if set. playwright-core does not download browsers. */
export function browser() {
  const exe = process.env.CHROME_PATH;
  return chromium.launch({ headless: process.env.HEADED ? false : true, ...(exe ? { executablePath: exe } : { channel: "chrome" }) });
}

export const PW = "Ll-" + crypto.randomBytes(9).toString("hex") + "!Zq9";

/**
 * Signs up a Clerk test user. Needs a Clerk *development* instance: emails containing `+clerk_test`
 * accept the fixed code 424242. Turn off "Challenge suspicious sign-ups" while running, then turn it back on.
 */
export async function signUp(page, email, tag) {
  await page.goto(BASE_URL);
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); // header button
  await page.getByRole("link", { name: /sign up/i }).or(page.getByText("Sign up", { exact: true })).first().click();
  await page.waitForTimeout(1500);
  await page.getByLabel(/email address/i).fill(email);
  await page.locator('input[type="password"]').first().fill(PW);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const code = page.getByLabel(/verification code|enter code/i).or(page.locator('input[autocomplete="one-time-code"]')).first();
  await code.waitFor({ timeout: 100000 }).catch(() => {});
  if (await code.count()) await code.pressSequentially("424242", { delay: 80 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(SHOTS, `signup-${tag}.png`) });
}
