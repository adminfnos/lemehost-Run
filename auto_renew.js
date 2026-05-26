const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');
const fs = require('fs').promises;

async function solveCaptcha(imageBuffer) {
  try {
    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    });
    const result = text.replace(/[^a-zA-Z0-9]/g, '').trim();
    console.log(`🔤 Tesseract: "${text.trim()}" → "${result}"`);
    return result || null;
  } catch (err) {
    console.error("❌ Tesseract 失败:", err.message);
    return null;
  }
}

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
// 主流程：先尝试代理，超时自动降级直连
// ============================================================
(async () => {
  const useProxy = !!process.env.USE_PROXY;
  const url = 'https://lemehost.com/server/10131731/free-plan';

  let browser, context, page;

  // --- 尝试代理 ---
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

  // --- 直连（代理失败或未配置代理时）---
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
    // 如果是直连且没访问过，现在访问
    if (!page.url().includes('lemehost.com')) {
      console.log("🌐 正在访问页面...");
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      // 等待页面JS渲染
      console.log("🌐 等待页面完全加载...");
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    }

    await page.waitForTimeout(2000);
    await page.waitForSelector('text=Extend time', { timeout: 15000 }).catch(() => {
      console.log("⚠️  等待 Extend time 超时，继续...");
    });

    const autoStopBefore = await getAutoStopSeconds(page);

    // ============================================================
    // 最多重试 3 次
    // ============================================================
    const MAX_TRIES = 3;
    let success = false;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      console.log(`\n🔁 第 ${attempt}/${MAX_TRIES} 次尝试...`);

      const captchaImg = page.locator('img[src*="captcha"]').first();
      const hasCaptcha = await captchaImg.isVisible().catch(() => false);
      console.log(`🔎 验证码: ${hasCaptcha ? '有' : '无'}`);

      if (hasCaptcha) {
        const imgBuffer = await captchaImg.screenshot();
        await fs.writeFile(`captcha_attempt${attempt}.png`, imgBuffer);
        const captchaText = await solveCaptcha(imgBuffer);

        if (captchaText) {
          const filled = await page.evaluate((code) => {
            const inp =
              document.querySelector('input[name="captcha"]') ||
              document.querySelector('.field-captcha input') ||
              Array.from(document.querySelectorAll('input[type="text"],input:not([type])')).find(i => !i.value);
            if (inp) {
              inp.value = code;
              inp.dispatchEvent(new Event('input', { bubbles: true }));
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              return inp.name || inp.className || 'found';
            }
            return null;
          }, captchaText);
          console.log(filled ? `✅ 已填入 (${filled})` : "❌ 未找到输入框");
          await page.waitForTimeout(500);
        } else {
          console.log("❌ 识别为空，跳过");
        }
      }

      const extendBtn = page.locator('text=Extend time');
      if (await extendBtn.isVisible()) {
        await extendBtn.click();
        console.log("✅ 已点击 Extend time");
        await page.waitForTimeout(4000);
      } else {
        console.log("❌ 未找到 Extend time");
        break;
      }

      await page.screenshot({ path: `after_extend_attempt${attempt}.png`, fullPage: true });

      const isBlank = await page.locator('text=Captcha cannot be blank').isVisible().catch(() => false);
      const isWrong = await page.locator('text=The verification code is incorrect').isVisible().catch(() => false);
      const isWrong2 = await page.locator('text=Wrong captcha').isVisible().catch(() => false);

      if (isBlank || isWrong || isWrong2) {
        console.log(`⚠️  [${attempt}] ${isBlank ? '验证码为空' : '验证码错误'}，重试...`);
      } else {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        const autoStopAfter = await getAutoStopSeconds(page);
        if (autoStopAfter > 0) {
          console.log(`🎉 续期成功！Auto-stop = ${autoStopAfter} 秒`);
          success = true;
          break;
        } else {
          console.log("😐 Auto-stop 仍为零，重试...");
        }
      }

      if (attempt < MAX_TRIES) {
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
        await page.waitForSelector('text=Extend time', { timeout: 10000 }).catch(() => {});
      }
    }

    if (!success) console.log("\n⚠️  3次后未确认续期成功");

    await page.screenshot({ path: 'final_status.png', fullPage: true });

    if (!success) {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);
    }

    const statusEl = page.locator('body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-heading > span:nth-child(2)');
    let finalStatus = "";
    for (let i = 0; i < 10; i++) {
      finalStatus = (await statusEl.innerText().catch(() => "")).toLowerCase().trim();
      if (finalStatus === "connecting..." || finalStatus === "") {
        console.log(`⏳ "${finalStatus}"，等待... (${i+1}/10)`);
        await page.waitForTimeout(2000);
      } else break;
    }

    console.log(`📡 最终状态: "${finalStatus}"`);

    if (finalStatus.includes('offline')) {
      const startBtn = page.locator('body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-body > button:nth-child(1)');
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 已点击 Start！");
        await page.waitForTimeout(8000);
      }
    } else if (finalStatus.includes('online')) {
      console.log("✨ 服务器在线。");
    } else if (finalStatus.includes('starting')) {
      console.log("🔄 启动中，正常。");
    } else {
      console.log(`🤔 未知状态: "${finalStatus}"`);
    }

  } catch (err) {
    console.error("❌ 出错:", err.message);
    await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
