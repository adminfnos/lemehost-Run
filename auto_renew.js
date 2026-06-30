const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs').promises;
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

// ============================================================
// 直接下载验证码原图（避免截图压缩失真）
// ============================================================
async function downloadCaptchaImage(page, attempt) {
  try {
    const captchaImg = page.locator('img[src*="captcha"]').first();
    const src = await captchaImg.getAttribute('src');
    if (!src) throw new Error('无法获取验证码 src');

    // 构造完整 URL
    const baseUrl = 'https://lemehost.com';
    const fullUrl = src.startsWith('http') ? src : baseUrl + src;
    console.log(`🔗 验证码URL: ${fullUrl}`);

    // 用 page.evaluate 在浏览器内 fetch，带上 cookie
    const imageBase64 = await page.evaluate(async (url) => {
      const res = await fetch(url, { credentials: 'include' });
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary);
    }, fullUrl);

    const imageBuffer = Buffer.from(imageBase64, 'base64');
    const rawPath = `captcha_raw_attempt${attempt}.png`;
    await fs.writeFile(rawPath, imageBuffer);
    console.log(`🖼️  原图已保存: ${rawPath} (${imageBuffer.length} bytes)`);
    return rawPath;
  } catch (err) {
    console.warn(`⚠️  下载原图失败(${err.message})，降级用截图`);
    // 降级：截图
    const captchaImg = page.locator('img[src*="captcha"]').first();
    const rawBuffer = await captchaImg.screenshot();
    const rawPath = `captcha_raw_attempt${attempt}.png`;
    await fs.writeFile(rawPath, rawBuffer);
    return rawPath;
  }
}

// ============================================================
// 用 ddddocr (Python) 多策略识别验证码
// ============================================================
async function solveCaptcha(imagePath, attempt) {
  try {
    const { stdout, stderr } = await execFileAsync('python3', ['solve_captcha.py', imagePath], {
      timeout: 30000
    });
    if (stderr) console.log(`🔍 ddddocr详情:\n${stderr.trim()}`);
    const result = stdout.replace(/[^a-zA-Z0-9]/g, '').trim();
    console.log(`🔤 最终识别: "${result}"`);
    return result || null;
  } catch (err) {
    console.error("❌ ddddocr 识别失败:", err.message);
    return null;
  }
}

// ============================================================
// 点击验证码图片，让它换一张（不刷新整页）
// ============================================================
async function refreshCaptchaByClick(page) {
  try {
    const captchaImg = page.locator('img[src*="captcha"]').first();
    const oldSrc = await captchaImg.getAttribute('src').catch(() => null);

    await captchaImg.click({ timeout: 5000 });
    console.log("🖱️  已点击验证码图片");

    // 等待 src 发生变化（多数验证码点击后会带新的时间戳/token）
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(300);
      const newSrc = await captchaImg.getAttribute('src').catch(() => null);
      if (newSrc && newSrc !== oldSrc) {
        console.log("🔄 验证码图片已刷新（src 已变化）");
        return true;
      }
    }
    console.log("⚠️  未检测到 src 变化，按延时继续（图片可能已用同一URL换了新图）");
    return true;
  } catch (err) {
    console.warn(`⚠️  点击验证码刷新失败: ${err.message}`);
    return false;
  }
}

// ============================================================
// 读取 Auto-stop 时间
// ============================================================
async function getAutoStopSeconds(page) {
  try {
    const bodyText = await page.locator('body').innerText();
    const match = bodyText.match(/Auto-stop\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!match) return -1;
    const s = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
    console.log(`⏱️  Auto-stop: ${match[1]}:${match[2]}:${match[3]} (${s}秒)`);
    return s;
  } catch { return -1; }
}

// ============================================================
// 主流程
// ============================================================
(async () => {
  const useProxy = !!process.env.USE_PROXY;
  const url = 'https://lemehost.com/server/10131731/free-plan';

  let browser, context, page;

  if (useProxy) {
    console.log("🔌 尝试代理模式...");
    try {
      browser = await chromium.launch({
        headless: true,
        proxy: { server: 'socks5://127.0.0.1:10808' }
      });
      context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });
      const cookies = JSON.parse(process.env.MY_COOKIES);
      await context.addCookies(cookies);
      page = await context.newPage();
      console.log("🌐 代理模式访问目标页面（测试20秒）...");
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      console.log("✅ 代理模式可用，继续使用代理");
    } catch (e) {
      console.log(`⚠️  代理访问失败: ${e.message.split('\n')[0]}`);
      console.log("🔄 降级为直连模式...");
      await browser.close().catch(() => {});
      browser = null; context = null; page = null;
    }
  }

  if (!browser) {
    console.log("🔌 使用直连模式...");
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    const cookies = JSON.parse(process.env.MY_COOKIES);
    await context.addCookies(cookies);
    page = await context.newPage();
  }

  try {
    if (!page.url().includes('lemehost.com')) {
      console.log("🌐 正在访问页面...");
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      console.log("🌐 等待页面完全加载...");
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    }

    await page.waitForTimeout(2000);
    await page.waitForSelector('text=Extend time', { timeout: 15000 }).catch(() => {
      console.log("⚠️  等待 Extend time 超时，继续...");
    });

    await getAutoStopSeconds(page);

    const MAX_TRIES = 50;
    let success = false;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      console.log(`\n🔁 第 ${attempt}/${MAX_TRIES} 次尝试...`);

      // 第一次直接用页面上已有的验证码；之后每次都点击验证码图片换一张，不刷新整页
      if (attempt > 1) {
        console.log("🔄 点击验证码图片获取新验证码（不刷新整页）...");
        await refreshCaptchaByClick(page);
        await page.waitForTimeout(800);
      }

      const captchaImg = page.locator('img[src*="captcha"]').first();
      const hasCaptcha = await captchaImg.isVisible().catch(() => false);
      console.log(`🔎 验证码: ${hasCaptcha ? '有' : '无'}`);

      if (hasCaptcha) {
        // 直接下载原图，避免截图压缩
        const imagePath = await downloadCaptchaImage(page, attempt);

        const captchaText = await solveCaptcha(imagePath, attempt);

        if (captchaText) {
          // 长度校验：该验证码固定为7位，识别结果不是7位说明漏识别/多识别，直接换图重试
          if (captchaText.length !== 7) {
            console.log(`⚠️  识别结果 "${captchaText}" 长度异常(${captchaText.length}位，期望7位)，换图重试...`);
            continue;
          }
          const filled = await page.evaluate((code) => {
            // 实际的 name 是 "ExtendFreePlanForm[captcha]"，用 *= 做包含匹配，
            // 不再依赖"是否为空"来判断，避免刷新验证码后旧值残留导致找不到输入框
            const inp =
              document.querySelector('input[name*="captcha"]') ||
              document.querySelector('.field-captcha input') ||
              document.querySelector('input[id*="captcha"]') ||
              Array.from(document.querySelectorAll('input[type="text"],input:not([type])'))[0];
            if (inp) {
              inp.value = '';
              inp.value = code;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              return inp.name || inp.className || 'found';
            }
            return null;
          }, captchaText);
          console.log(filled ? `✅ 已填入 "${captchaText}" (${filled})` : "❌ 未找到输入框");
          await page.waitForTimeout(500);
        } else {
          console.log("❌ 识别为空，本次跳过，下一轮会重新点击验证码再试");
          continue;
        }
      }

      const extendBtn = page.locator('text=Extend time');
      if (await extendBtn.isVisible()) {
        await extendBtn.click();
        console.log("✅ 已点击 Extend time");
        await page.waitForTimeout(4000);
      } else {
        console.log("❌ 未找到 Extend time 按钮");
        break;
      }

      await page.screenshot({ path: `after_extend_attempt${attempt}.png`, fullPage: true });

      const isBlank = await page.locator('text=Captcha cannot be blank').isVisible().catch(() => false);
      const isWrong = await page.locator('text=The verification code is incorrect').isVisible().catch(() => false);
      const isWrong2 = await page.locator('text=Wrong captcha').isVisible().catch(() => false);

      if (isBlank || isWrong || isWrong2) {
        console.log(`⚠️  [${attempt}] ${isBlank ? '验证码为空' : '验证码错误'}，下一轮将点击验证码图片换一张再试...`);
      } else {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const autoStopAfter = await getAutoStopSeconds(page);
        if (autoStopAfter > 0) {
          console.log(`🎉 续期成功！Auto-stop = ${autoStopAfter} 秒`);
          success = true;
          break;
        } else {
          console.log("😐 Auto-stop 仍为零，继续重试...");
        }
      }
    }

    if (!success) console.log("\n⚠️  5次后未确认续期成功");

    await page.screenshot({ path: 'final_status.png', fullPage: true });

    if (!success) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    }

    // ============================================================
    // 读取最终服务器状态
    // ============================================================
    let finalStatus = "";
    const statusSelectors = [
      '.panel-heading span:nth-child(2)',
      '.panel-heading .label',
      '.server-status',
      '.panel-heading span'
    ];

    for (let i = 0; i < 10; i++) {
      for (const sel of statusSelectors) {
        const text = (await page.locator(sel).first().innerText().catch(() => "")).toLowerCase().trim();
        if (text && text !== "connecting...") {
          finalStatus = text;
          break;
        }
      }
      if (finalStatus && finalStatus !== "connecting...") break;
      console.log(`⏳ 等待状态稳定... (${i+1}/10)`);
      await page.waitForTimeout(2000);
    }

    console.log(`📡 最终状态: "${finalStatus}"`);

    const bodyTextFinal = (await page.locator('body').innerText().catch(() => "")).toLowerCase();
    const isOffline = finalStatus.includes('offline')
      || bodyTextFinal.includes('server is offline')
      || await page.locator('.label-danger, .status-offline, span.offline').isVisible().catch(() => false);
    const isOnline  = finalStatus.includes('online') && !finalStatus.includes('offline');
    const isStarting = finalStatus.includes('starting') || finalStatus.includes('start');

    // ============================================================
    // 通用 Start 点击函数：等待按钮从 disabled 变为 enabled 再点
    // ============================================================
    async function clickStartWhenReady() {
      const startBtn = page.locator('button[data-state="start"], button:has-text("Start"), input[value="Start"]').first();
      const exists = await startBtn.isVisible().catch(() => false);
      if (!exists) { console.log("❌ 未找到 Start 按钮"); return; }

      // 等待按钮可点击（最多等 60 秒，应对 stopping → offline 的过渡）
      console.log("⏳ 等待 Start 按钮变为可点击状态（最多60秒）...");
      for (let w = 0; w < 12; w++) {
        const disabled = await startBtn.evaluate(el => el.disabled || el.hasAttribute('disabled')).catch(() => false);
        if (!disabled) break;
        console.log(`  [${w+1}/12] 按钮仍 disabled，等待5秒...`);
        await page.waitForTimeout(5000);
        // 刷新页面状态（不整页reload，只等）
        if (w % 3 === 2) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
          await page.waitForTimeout(2000);
        }
      }
      const stillDisabled = await startBtn.evaluate(el => el.disabled || el.hasAttribute('disabled')).catch(() => false);
      if (stillDisabled) {
        console.log("⚠️  Start 按钮等待60秒后仍 disabled，跳过");
        return;
      }
      await startBtn.click();
      console.log("🚀 已点击 Start！");
      await page.waitForTimeout(8000);
    }

    if (isOffline) {
      console.log("🔴 服务器离线，尝试点击 Start...");
      await clickStartWhenReady();
    } else if (isOnline) {
      console.log("✨ 服务器在线，无需操作。");
    } else if (isStarting) {
      console.log("🔄 服务器启动中，正常。");
    } else {
      console.log(`🤔 未知状态: "${finalStatus}"，尝试查找 Start 按钮...`);
      await clickStartWhenReady();
    }

  } catch (err) {
    console.error("❌ 出错:", err.message);
    await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
