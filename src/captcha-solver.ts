import Jimp from 'jimp';
import { Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

export interface CaptchaResult {
  success: boolean;
  distance: number;
  elapsedMs: number;
}

const MAX_RETRIES = 3;
const SLIDER_HANDLE_SELECTOR = '.slider-handle, .nc_iconfont.btn_slide, [class*="slider"][class*="handle"], .nc_scale .btn_slide';
const SLIDER_BG_SELECTOR = '.slider-img, .nc_scale .scale_bg, [class*="slider"][class*="bg"]';
const PUZZLE_IMG_SELECTOR = '.puzzle-img, .nc_scale .scale_puzzle, [class*="puzzle"][class*="img"]';
const CANVAS_CONTAINER_SELECTOR = '.nc_scale, .slider-captcha, [class*="captcha-container"]';

const SCRATCH_DIR = path.resolve(__dirname, '..', 'scratch');

interface GapResult {
  x: number;
  confidence: number;
}

async function findGapX(
  bgPath: string,
  puzzlePath: string
): Promise<GapResult> {
  const [bg, puzzle] = await Promise.all([
    Jimp.read(bgPath),
    Jimp.read(puzzlePath),
  ]);

  const bgW = bg.bitmap.width;
  const bgH = bg.bitmap.height;
  const puzW = puzzle.bitmap.width;
  const puzH = puzzle.bitmap.height;

  const pPuzzle = puzW > bgW || puzH > bgH ? puzzle.resize(bgW, bgH) : puzzle;
  const pw = pPuzzle.bitmap.width;
  const ph = pPuzzle.bitmap.height;

  const startCol = Math.floor(bgW * 0.1);
  const endCol = Math.floor(bgW * 0.85);

  let bestX = startCol;
  let bestScore = Infinity;

  for (let offset = startCol; offset < endCol; offset++) {
    let score = 0;
    let sampledPixels = 0;

    for (let y = 1; y < Math.min(bgH, ph) - 1; y += 3) {
      for (let x = 1; x < Math.min(bgW - offset, pw) - 1; x += 2) {
        const bgX = offset + x;
        if (bgX >= bgW) break;

        const bgColor = Jimp.intToRGBA(bg.getPixelColor(bgX, y));
        const pColor = Jimp.intToRGBA(pPuzzle.getPixelColor(x, y));

        if (pColor.a < 128) continue;

        const dr = bgColor.r - pColor.r;
        const dg = bgColor.g - pColor.g;
        const db = bgColor.b - pColor.b;
        score += dr * dr + dg * dg + db * db;
        sampledPixels++;
      }
    }

    if (sampledPixels > 0) {
      const avgScore = score / sampledPixels;
      if (avgScore < bestScore) {
        bestScore = avgScore;
        bestX = offset;
      }
    }
  }

  let refinedX = bestX;
  let refinedScore = bestScore;
  const refineStart = Math.max(startCol, bestX - 15);
  const refineEnd = Math.min(endCol, bestX + 15);

  for (let offset = refineStart; offset <= refineEnd; offset++) {
    let score = 0;
    let sampledPixels = 0;

    for (let y = 1; y < Math.min(bgH, ph) - 1; y += 1) {
      for (let x = 1; x < Math.min(bgW - offset, pw) - 1; x += 1) {
        const bgX = offset + x;
        if (bgX >= bgW) break;

        const bgColor = Jimp.intToRGBA(bg.getPixelColor(bgX, y));
        const pColor = Jimp.intToRGBA(pPuzzle.getPixelColor(x, y));
        if (pColor.a < 128) continue;

        const dr = bgColor.r - pColor.r;
        const dg = bgColor.g - pColor.g;
        const db = bgColor.b - pColor.b;
        score += dr * dr + dg * dg + db * db;
        sampledPixels++;
      }
    }

    if (sampledPixels > 0) {
      const avgScore = score / sampledPixels;
      if (avgScore < refinedScore) {
        refinedScore = avgScore;
        refinedX = offset;
      }
    }
  }

  return {
    x: refinedX,
    confidence: 1 - refinedScore / 255,
  };
}

interface Point {
  x: number;
  y: number;
}

function bezierCurve(
  start: Point,
  end: Point,
  control1: Point,
  control2: Point,
  steps: number
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const x = uuu * start.x + 3 * uu * t * control1.x + 3 * u * tt * control2.x + ttt * end.x;
    const y = uuu * start.y + 3 * uu * t * control1.y + 3 * u * tt * control2.y + ttt * end.y;

    points.push({ x: Math.round(x), y: Math.round(y) });
  }
  return points;
}

function generateHumanDrag(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number
): Point[] {
  const distance = Math.abs(targetX - startX);
  const direction = targetX > startX ? 1 : -1;

  const overshoot = 3 + Math.random() * 5;
  const overshootX = targetX + direction * overshoot;

  const control1: Point = {
    x: startX + distance * 0.3 + Math.random() * 20,
    y: startY + (Math.random() - 0.5) * 10,
  };
  const control2: Point = {
    x: targetX - distance * 0.2 + Math.random() * 15,
    y: targetY + (Math.random() - 0.5) * 10,
  };

  const steps1 = Math.max(25, Math.min(60, Math.floor(distance / 3)));
  const toOvershoot = bezierCurve(
    { x: startX, y: startY },
    { x: overshootX, y: targetY },
    control1,
    control2,
    steps1
  );

  const steps2 = Math.max(5, Math.floor(steps1 * 0.2));
  const correctionPoints = bezierCurve(
    { x: overshootX, y: targetY },
    { x: targetX, y: targetY },
    { x: overshootX - direction * 2, y: targetY + Math.random() * 3 },
    { x: targetX - direction * 1, y: targetY + Math.random() * 3 },
    steps2
  );

  const fullPath = [...toOvershoot];
  for (let i = 1; i < correctionPoints.length; i++) {
    fullPath.push(correctionPoints[i]);
  }

  return fullPath;
}

async function simulateHumanDrag(
  page: Page,
  handleSelector: string,
  startX: number,
  startY: number,
  distance: number
): Promise<void> {
  const targetX = startX + distance;
  const path = generateHumanDrag(startX, startY, targetX, startY);

  const initPath = bezierCurve(
    { x: startX - (20 + Math.random() * 30), y: startY - (5 + Math.random() * 10) },
    { x: startX, y: startY },
    { x: startX - 10, y: startY - 5 },
    { x: startX - 2, y: startY },
    15
  );

  for (const p of initPath) {
    await page.mouse.move(p.x, p.y);
    await sleep(5 + Math.random() * 8);
  }

  await page.mouse.down();

  for (const p of path) {
    await page.mouse.move(p.x, p.y);
    await sleep(3 + Math.random() * 9);
  }

  await sleep(30 + Math.random() * 50);

  await page.mouse.up();
}

export async function solveSliderCaptcha(
  page: Page,
  index: number,
  total: number
): Promise<CaptchaResult> {
  if (!fs.existsSync(SCRATCH_DIR)) {
    fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  }

  const startTime = Date.now();

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await page.waitForSelector(SLIDER_HANDLE_SELECTOR, { timeout: 10000 });
      await page.waitForSelector(SLIDER_BG_SELECTOR, { timeout: 5000 });

      const handleEl = await page.$(SLIDER_HANDLE_SELECTOR);
      const bgEl = await page.$(SLIDER_BG_SELECTOR);

      if (!handleEl || !bgEl) {
        throw new Error('Captcha elements not found');
      }

      const handleBox = await handleEl.boundingBox();
      const bgBox = await bgEl.boundingBox();

      if (!handleBox || !bgBox) {
        throw new Error('Cannot get bounding boxes for captcha elements');
      }

      const bgScreenshot = path.join(SCRATCH_DIR, `bg_${crypto.randomUUID().slice(0, 8)}.png`);
      const puzzleScreenshot = path.join(SCRATCH_DIR, `puzzle_${crypto.randomUUID().slice(0, 8)}.png`);

      const puzzleEl = await page.$(PUZZLE_IMG_SELECTOR);
      if (puzzleEl) {
        await puzzleEl.screenshot({ path: puzzleScreenshot });
      } else {
        await handleEl.screenshot({ path: puzzleScreenshot });
      }
      await bgEl.screenshot({ path: bgScreenshot });

      const gap = await findGapX(bgScreenshot, puzzleScreenshot);

      try {
        fs.unlinkSync(bgScreenshot);
        fs.unlinkSync(puzzleScreenshot);
      } catch {
      }

      if (gap.x < 5) {
        throw new Error(`Gap detection returned suspicious position: ${gap.x}px`);
      }

      const handleWidth = handleBox.width;
      const distance = Math.max(1, Math.round(gap.x - handleWidth * 0));

      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      await simulateHumanDrag(page, SLIDER_HANDLE_SELECTOR, startX, startY, distance);

      await sleep(800 + Math.random() * 600);

      const passed = await isCaptchaPassed(page);

      if (passed) {
        return {
          success: true,
          distance: gap.x,
          elapsedMs: Date.now() - startTime,
        };
      }

      if (attempt < MAX_RETRIES) {
        await sleep(1000 + Math.random() * 1000);
      }
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        await sleep(1500 + Math.random() * 1000);
        continue;
      }
      throw new Error(`Captcha failed after ${MAX_RETRIES} attempts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`Captcha failed after ${MAX_RETRIES} attempts`);
}

async function isCaptchaPassed(page: Page): Promise<boolean> {
  try {
    const successSelectors = [
      '.nc-lang-cnt, .nc_iconfont.btn_ok, [class*="success"]',
    ];

    for (const sel of successSelectors) {
      const el = await page.$(sel);
      if (el) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) return true;
      }
    }

    const handle = await page.$(SLIDER_HANDLE_SELECTOR);
    if (!handle) return true;

    const box = await handle.boundingBox();
    if (!box) return true;

    const container = await page.$(CANVAS_CONTAINER_SELECTOR);
    if (container) {
      const containerBox = await container.boundingBox();
      if (containerBox && box.x >= containerBox.x + containerBox.width - 10) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
