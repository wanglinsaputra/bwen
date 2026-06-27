import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page, Locator } from 'playwright';
import fs from 'fs';
import chalk from 'chalk';

import { config } from './config';
import { pollForOtp } from './otp-reader';
import { solveSliderCaptcha } from './captcha-solver';
import { generateTempMailAddress, pollTempMailAPI } from './temp-mail';
import { ProxyConfig } from './proxy';
import { getTui } from './tui';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TYPING_DELAY_MIN = 80;
const TYPING_DELAY_MAX = 150;

function getRegionFromProxy(proxy?: ProxyConfig): string {
  if (!proxy || !proxy.username) return 'Indonesia';

  const user = proxy.username.toLowerCase();
  if (user.includes('.sg')) return 'Singapore';
  if (user.includes('.us')) return 'United States';
  if (user.includes('.id')) return 'Indonesia';
  if (user.includes('.my')) return 'Malaysia';
  if (user.includes('.jp')) return 'Japan';
  if (user.includes('.uk') || user.includes('.gb')) return 'United Kingdom';

  return 'Indonesia';
}

const stealth = StealthPlugin();
stealth.enabledEvasions.delete('user-agent-override');
chromium.use(stealth);

export interface WorkerResult {
  email: string;
  status: 'SUCCESS' | 'FAILED';
  apiKey: string;
  baseUrl: string;
  elapsed: number;
  error?: string;
}

const BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const API_KEYS_URL = 'https://home.qwencloud.com/api-keys';

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

async function createBrowser(proxy?: ProxyConfig): Promise<{ browser: Browser; page: Page }> {
  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const launchOpts: any = {
    headless: config.headless,
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      `--user-agent=${userAgent}`,
    ],
  };

  const browser = await chromium.launch(launchOpts);

  const contextOptions: any = {
    ignoreHTTPSErrors: true,
    viewport: {
      width: 1920 + Math.floor(Math.random() * 50),
      height: 1080 + Math.floor(Math.random() * 50),
    },
    userAgent,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: [],
  };

  if (proxy) {
    contextOptions.proxy = {
      server: `http://${proxy.ip}:${proxy.port}`,
      bypass: '*.nca.my.id, *.ncaori.my.id, nca.my.id'
    };
    if (proxy.username) {
      contextOptions.proxy.username = proxy.username;
      contextOptions.proxy.password = proxy.password;
    }
  }

  const context = await browser.newContext(contextOptions);



  await context.addInitScript(`() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  }`);

  const page = await context.newPage();
  await page.setViewportSize({
    width: 1920 + Math.floor(Math.random() * 50),
    height: 1080 + Math.floor(Math.random() * 50),
  });

  return { browser, page };
}

async function registerFlow(page: Page, workerId: number, email: string): Promise<void> {
  getTui().updateWorker(workerId, 'signing up...');
  const expiredSsoUrl =
    'https://account.alibabacloud.com/sso/register?response_type=code&client_id=qwencloud&scope=openid' +
    '&state=733558d0517d4a20b6e17084043575cf' +
    '&redirect_uri=https%3A%2F%2Faccount.qwencloud.com%2Fsso%2FssoLogin' +
    '&return_url=https%3A%2F%2Fhome.qwencloud.com%2Ftry-ai' +
    '&expireTime=1782428100010' +
    '&accounttraceid=a0a635dc9e794010a5ceb2bc0e56dab5sjbr' +
    '&cspNonce=Z81fgVOBA4' +
    '&oauth_callback=https%3A%2F%2Fhome.qwencloud.com%2Ftry-ai' +
    '&_AC_WEB_START_MS_=56104610331658629';

  getTui().updateWorker(workerId, 'verifying proxy IP connection...');
  const ipCheck = await page.goto('https://api.ipify.org', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null);
  if (ipCheck) {
    const proxyIp = await page.innerText('body').catch(() => 'unknown-ip');
    getTui().updateWorker(workerId, `Proxy active: ${proxyIp.trim()}`);
    await page.waitForTimeout(2000);
  }

  await page.goto(expiredSsoUrl, { waitUntil: 'networkidle', timeout: 30000 });

  getTui().updateWorker(workerId, 'bypassing initial expired page...');
  const refreshBtn = page.getByRole('button', { name: 'Refresh', exact: true });
  await refreshBtn.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (await refreshBtn.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {}),
      refreshBtn.click(),
    ]);
  }
  getTui().updateWorker(workerId, 'filling email...');

  const registerTab = page
    .getByRole('tab', { name: /sign.?up|register/i })
    .or(page.getByRole('link', { name: /sign.?up|register/i }))
    .or(page.getByText(/sign.?up|register/i))
    .or(page.locator('a, button, span').filter({ hasText: /sign.?up|register/i }))
    .first();

  await registerTab.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});

  if (await registerTab.isVisible().catch(() => false)) {
    await registerTab.click();
  }

  const emailInput = page.getByRole('textbox').or(page.locator('input[type="text"]')).first();
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await emailInput.click();

  await emailInput.pressSequentially(email, {
    delay: TYPING_DELAY_MIN + Math.random() * (TYPING_DELAY_MAX - TYPING_DELAY_MIN),
  });

  await clickSendCode(page, workerId);

  getTui().updateWorker(workerId, 'waiting for OTP...');
  const errorOrOtp = page.getByText('This email is already registered', { exact: false })
    .or(page.locator('input[inputmode="numeric"][maxlength="1"]').first());
  await errorOrOtp.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

  const errorLocator = page.getByText('This email is already registered', { exact: false });
  const isErrorVisible = await errorLocator.isVisible().catch(() => false);

  if (isErrorVisible) {
    throw new Error('Email already registered');
  }
}

async function clickSendCode(page: Page, workerId: number): Promise<void> {
  getTui().updateWorker(workerId, 'signing up...');
  const sendBtn = page
    .getByRole('button')
    .or(page.getByRole('link'))
    .or(page.locator('span'))
    .filter({ hasText: /send/i })
    .first();

  if (await sendBtn.isVisible().catch(() => false)) {
    await sendBtn.click();
    return;
  }

  await page.keyboard.press('Enter');
}

const PAGE_EXPIRED_MAX_RETRIES = 2;
const pageExpiredCounts = new Map<number, number>();

async function handlePageExpired(page: Page, workerId: number): Promise<void> {
  const expiredText = page.getByText('Page Expired', { exact: false }).first();
  const isVisible = await expiredText.isVisible({ timeout: 1500 }).catch(() => false);
  if (!isVisible) return;

  const currentCount = (pageExpiredCounts.get(workerId) || 0) + 1;
  pageExpiredCounts.set(workerId, currentCount);
  if (currentCount > PAGE_EXPIRED_MAX_RETRIES) {
    throw new Error('SESSION_STUCK_EXPIRED');
  }

  getTui().updateWorker(workerId, 'session expired, reloading...');

  const refreshBtn = page.getByRole('button', { name: 'Refresh', exact: true });

  if (await refreshBtn.isVisible().catch(() => false)) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {}),
      refreshBtn.click(),
    ]);
  } else {
    await page.keyboard.press('Enter');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  }

  const emailInput = page.getByRole('textbox').or(page.locator('input[type="text"]')).first();
  await emailInput.waitFor({ state: 'visible', timeout: 20000 });

  getTui().updateWorker(workerId, 'signing up...');
}

async function fillOtp(page: Page, workerId: number, otp: string): Promise<void> {
  getTui().updateWorker(workerId, 'filling OTP...');

  const otpInputs = page.locator('input[inputmode="numeric"][maxlength="1"]');
  await otpInputs.first().waitFor({ state: 'visible', timeout: 15000 });

  for (let i = 0; i < 6; i++) {
    if (i < otp.length) {
      await otpInputs.nth(i).pressSequentially(otp[i], {
        delay: TYPING_DELAY_MIN + Math.random() * (TYPING_DELAY_MAX - TYPING_DELAY_MIN),
      });
    }
  }

  const invalidError = page.getByText(/invalid.*code|incorrect/i);
  if (await invalidError.isVisible({ timeout: 2000 }).catch(() => false)) {
    throw new Error('Invalid OTP code entered.');
  }
}

async function selectRegion(page: Page, workerId: number, regionName: string): Promise<void> {
  getTui().updateWorker(workerId, `selecting region: ${regionName}...`);

  const regionInput = page.getByPlaceholder('Select your country/region')
    .or(page.locator('input[role="combobox"]'))
    .first();

  await regionInput.waitFor({ state: 'visible', timeout: 15000 });

  await regionInput.click();

  const targetOption = page.locator(`text="${regionName}"`)
    .or(page.getByRole('option', { name: new RegExp(regionName, 'i') }))
    .first();

  if (await targetOption.isVisible({ timeout: 5000 }).catch(() => false)) {
    await targetOption.click();
  } else {
    await regionInput.pressSequentially(regionName, {
      delay: TYPING_DELAY_MIN + Math.random() * (TYPING_DELAY_MAX - TYPING_DELAY_MIN),
    });
    await page.keyboard.press('Enter');
  }
}

async function checkAgreement(page: Page, workerId: number): Promise<void> {
  getTui().updateWorker(workerId, 'checking agreement...');

  const agreeText = page.locator('.maas-terms-text__content')
    .or(page.getByText(/I hereby agree to the Qwen/i))
    .first();

  await agreeText.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
  await agreeText.click();
}

async function clickContinue(page: Page, workerId: number): Promise<void> {
  getTui().updateWorker(workerId, 'continuing (waiting for SSO)...');

  const continueBtn = page.getByRole('button', { name: 'Continue', exact: true })
    .or(page.locator('button[type="submit"]'))
    .first();

  await continueBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);

  await Promise.all([
    page.waitForURL(/home\.qwencloud\.com/, { timeout: 30000 }).catch(() => {}),
    continueBtn.click(),
  ]);
}

async function goToApiKeysPage(page: Page, workerId: number): Promise<void> {
  getTui().updateWorker(workerId, 'stabilizing dashboard...');

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  getTui().updateWorker(workerId, 'navigating to API keys...');

  await page.goto(API_KEYS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(e => {
    if (!e.message.includes('ERR_ABORTED')) {
      throw e;
    }
  });

  const createBtn = page.locator('button').filter({ hasText: /Create.*API.*key/i }).first();
  await createBtn.waitFor({ state: 'visible', timeout: 15000 });
}

async function createAndExtractApiKey(page: Page, workerId: number): Promise<string> {
  getTui().updateWorker(workerId, 'clicking create key...');

  const createBtn = page.locator('button').filter({ hasText: /Create.*API.*key/i }).first();
  await createBtn.waitFor({ state: 'visible', timeout: 15000 });
  await createBtn.click();
  await page.waitForTimeout(1500);

  const nameInput = page.locator('input[placeholder*="API"], input[maxlength="50"]').first();
  if (await nameInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nameInput.click();
    await nameInput.pressSequentially('FVCKEVERYTHING', { delay: 100 });
  }

  const confirmBtn = page.locator('div[role="dialog"] button, .ant-modal-content button')
    .filter({ hasText: /OK|Confirm|Create|Generate/i })
    .first();
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmBtn.click();
  }

  getTui().updateWorker(workerId, 'extracting sk-...');

  const apiKey: string | null = await (page.evaluate as any)(`(async () => {
    for (let i = 0; i < 30; i++) {
      const inputs = Array.from(document.querySelectorAll('input'));
      for (const input of inputs) {
        if (input.value && input.value.trim().startsWith('sk-')) return input.value.trim();
      }
      const match = document.body.innerText.match(/(sk-[a-zA-Z0-9]{20,})/);
      if (match && match[1]) return match[1];
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return null;
  })()`);

  if (!apiKey) {
    throw new Error('UI element missing: API Key starting with sk- not found in DOM.');
  }

  const closeBtn = page.locator('button').filter({ hasText: /Close|Done|Got it/i }).first();
  if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await closeBtn.click();
  }

  return apiKey;
}

async function validateApiKey(workerId: number, apiKey: string, baseUrl: string): Promise<void> {
  getTui().updateWorker(workerId, 'validating key...');

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'qwen3.7-max',
      messages: [{ role: 'user', content: 'Hello!' }]
    })
  });

  if (!response.ok) {
    const errData = await response.text().catch(() => 'Unknown error');
    throw new Error(`API Validation Failed: HTTP ${response.status} - ${errData}`);
  }

  const data = await response.json().catch(() => ({})) as any;
  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('API Validation Failed: Invalid JSON response structure');
  }
}



const SUCCESS_KEYS_TXT = 'success_keys.txt';
const FAILED_CSV = 'failed_accounts.csv';

function appendSuccessCsv(email: string, apiKey: string, baseUrl: string): void {
  const username = email.split('@')[0];
  const row = `${username}|${apiKey}\n`;
  fs.appendFileSync(SUCCESS_KEYS_TXT, row, 'utf-8');
}

function appendFailedCsv(email: string, errorReason: string, apiKey: string = ''): void {
  const username = email.split('@')[0];
  const header = 'EMAIL,API_KEY,ERROR_REASON\n';
  const row = `${username},${apiKey},${errorReason}\n`;
  const exists = fs.existsSync(FAILED_CSV);
  fs.appendFileSync(FAILED_CSV, exists ? row : header + row, 'utf-8');
}

function shortErrorReason(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cleaned = msg.split('\n')[0].split('. ').slice(0, 2).join('. ');
  if (/validation failed|requires payment|no quota/i.test(cleaned)) return 'Validation Failed: Requires Payment / No Quota';
  if (/already registered/i.test(cleaned)) return 'Email already registered';
  if (/captcha/i.test(cleaned)) return 'Captcha block';
  if (/otp|imap|timeout/i.test(cleaned)) return 'OTP timeout';
  if (/element|selector|locator|not found|not visible/i.test(cleaned)) return 'UI element missing';
  if (/navigation|network|timeout/i.test(cleaned)) return 'Page load timeout';
  if (/browser|launch|connect/i.test(cleaned)) return 'Browser launch failed';
  return cleaned.length > 80 ? cleaned.substring(0, 77) + '...' : cleaned;
}

export interface WorkerInput {
  email: string;
  index: number;
  total: number;
  emailMethod: 'gmail' | 'tempmail';
  proxy?: ProxyConfig;
}

export async function runWorker(input: WorkerInput): Promise<WorkerResult> {
  const { emailMethod } = input;

  if (emailMethod === 'gmail') {
    return await runGmailWorker(input);
  } else {
    return await runTempMailWorker(input);
  }
}

async function runGmailWorker(input: WorkerInput): Promise<WorkerResult> {
  const { email, index, total } = input;
  const tui = getTui();
  const workerId = tui.claimWorker(email, input.proxy ? `${input.proxy.ip}:${input.proxy.port}` : undefined);
  const startTime = Date.now();
  let browser: Browser | null = null;
  let extractedApiKey = '';

  try {
    const { browser: br, page } = await createBrowser(input.proxy);
    browser = br;

    await registerFlow(page, workerId, email);

    const captchaContainer = page.locator('.nc_scale, .slider-captcha, [class*="captcha"], [class*="slider"]').first();
    if (await captchaContainer.isVisible({ timeout: 3000 }).catch(() => false)) {
      getTui().updateWorker(workerId, 'solving captcha...');
      const captchaResult = await solveSliderCaptcha(page, index, total);
      if (!captchaResult.success) {
        throw new Error('Captcha solving failed after all retries');
      }
    }

    getTui().updateWorker(workerId, 'waiting for OTP...');
    const otp = await pollForOtp(config.gmailUsername, config.gmailAppPassword, email);
    await fillOtp(page, workerId, otp);

    const targetRegion = getRegionFromProxy(input.proxy);
    await selectRegion(page, workerId, targetRegion);
    await checkAgreement(page, workerId);
    await clickContinue(page, workerId);

    await goToApiKeysPage(page, workerId);
    extractedApiKey = await createAndExtractApiKey(page, workerId);

    await validateApiKey(workerId, extractedApiKey, BASE_URL);

    const csvKey = extractedApiKey.length > 40 ? extractedApiKey.substring(0, 40) + '...' : extractedApiKey;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    const workerResult: WorkerResult = {
      email,
      status: 'SUCCESS',
      apiKey: csvKey,
      baseUrl: BASE_URL,
      elapsed,
    };

    appendSuccessCsv(email, extractedApiKey, BASE_URL);
    tui.freeWorker(workerId, 'SUCCESS');
    return workerResult;

  } catch (err) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    const result: WorkerResult = {
      email,
      status: 'FAILED',
      apiKey: extractedApiKey,
      baseUrl: BASE_URL,
      elapsed,
      error: shortErrorReason(err),
    };

    appendFailedCsv(email, shortErrorReason(err), extractedApiKey);
    tui.updateWorker(workerId, 'failed ✗');
    tui.freeWorker(workerId, 'FAILED');
    return result;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { }
    }
  }
}

async function runTempMailWorker(input: WorkerInput): Promise<WorkerResult> {
  const { email: placeholderEmail, index, total } = input;
  const tui = getTui();
  const startTime = Date.now();
  let browser: Browser | null = null;
  let extractedApiKey = '';
  let actualEmail = '';
  let workerId: number | null = null;

  try {
    actualEmail = generateTempMailAddress();
    workerId = tui.claimWorker(actualEmail, input.proxy ? `${input.proxy.ip}:${input.proxy.port}` : undefined);

    const { browser: br, page: qwenPage } = await createBrowser(input.proxy);
    browser = br;

    await registerFlow(qwenPage, workerId!, actualEmail);

    const captchaContainer = qwenPage.locator('.nc_scale, .slider-captcha, [class*="captcha"], [class*="slider"]').first();
    if (await captchaContainer.isVisible({ timeout: 3000 }).catch(() => false)) {
      getTui().updateWorker(workerId!, 'solving captcha...');
      const captchaResult = await solveSliderCaptcha(qwenPage, index, total);
      if (!captchaResult.success) {
        throw new Error('Captcha solving failed after all retries');
      }
    }

    const otp = await pollTempMailAPI(actualEmail, workerId!);

    await fillOtp(qwenPage, workerId!, otp);

    const targetRegion = getRegionFromProxy(input.proxy);
    await selectRegion(qwenPage, workerId!, targetRegion);
    await checkAgreement(qwenPage, workerId!);
    await clickContinue(qwenPage, workerId!);

    await goToApiKeysPage(qwenPage, workerId!);
    extractedApiKey = await createAndExtractApiKey(qwenPage, workerId!);

    await validateApiKey(workerId!, extractedApiKey, BASE_URL);

    const csvKey = extractedApiKey.length > 40 ? extractedApiKey.substring(0, 40) + '...' : extractedApiKey;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    const workerResult: WorkerResult = {
      email: actualEmail,
      status: 'SUCCESS',
      apiKey: csvKey,
      baseUrl: BASE_URL,
      elapsed,
    };

    appendSuccessCsv(actualEmail, extractedApiKey, BASE_URL);
    tui.freeWorker(workerId!, 'SUCCESS');
    return workerResult;

  } catch (err) {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);

    const result: WorkerResult = {
      email: actualEmail || placeholderEmail,
      status: 'FAILED',
      apiKey: extractedApiKey,
      baseUrl: BASE_URL,
      elapsed,
      error: shortErrorReason(err),
    };

    appendFailedCsv(actualEmail || placeholderEmail, shortErrorReason(err), extractedApiKey);

    if (workerId !== null) {
      try {
        tui.freeWorker(workerId, 'FAILED');
      } catch {}
    }
    return result;
  } finally {
    if (browser) {
      try { await browser.close(); } catch { }
    }
  }
}
