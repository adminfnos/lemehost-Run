const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');
const fs = require('fs').promises;

// ============================================================
// Tesseract 识别验证码
// ============================================================
async function solveCaptcha(imageBuffer) {
  try {
    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    });
    const result = text.replace(/[^a-zA-Z0-9]/g, '').trim();
    console.log(`🔤 Tesseract 识别: "${text.trim()}" → 清洗后: "${result}"`);
    return result || null;
  } catch (err) {
    console.error("❌ Tesseract 识别失败:", err.message);
    return null;
  }
}

// ============================================================
// 读取 Auto-stop 倒计时秒数
// ============================================================
async function getAutoStopSeconds(page) {
  try {
    const bodyText = await page.locator('body').innerText();
    const match = bodyText.match(/Auto-stop\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!match) return -1;
    const seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
    console.log(`⏱️  Auto-stop: ${match[1]}:${match[2]}:${match[3]} (${seconds}秒)`);
    return seconds;
  } catch {
    return -1;
  }
}

// ============================================================
// 创建浏览器（支持代理，失败自动降级直连）
// ============================================================
async function createBrowser(useProxy) {
  if (useProxy) {
    try {
      console.log("🔌 尝试使用代理模式启动浏览器...");
      const browser = await chromium.launch({
        headless: true,
        proxy: { server: 'socks5://127.0.0.1:10808' }
      });
      // 快速测试代理能否访问目标站
      const ctx = await browser.newContext();
      const testPage = await ctx.newPage();
      await testPage.goto('https://lemehost.com', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await testPage.close();
      await ctx.close();
      console.log("✅ 代理模式可用");
      return { browser, proxyWorked: true };
    } catch (e) {
      console.log(`⚠️  代理模式失败 (${e.message.split('\n')[0]})，自动切换直连...`);
    }
  }
  console.log("🔌 使用直连模式...");
  const browser = await chromium.launch({ headless: true });
  return { browser, proxyWorked: false };
}

// ============================================================
// 主流程
// ============================================================
(async () => {
  const useProxy = !!process.env.USE_PROXY;
  console.log(`🌐 代理设置: ${useProxy ? '尝试代理，失败自动降级直连' : '直连'}`);

  const { browser } = await createBrowser(useProxy);

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const cookies = JSON.parse(process.env.MY_COOKIES);
  await context.addCookies(cookies);

  const page = await context.newPage();
  const url = 'https://lemehost.com/server/10131731/free-plan';

  try {
    console.log("🌐 正在访问页面...");
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
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
        console.log(`📸 验证码截图: captcha_attempt${attempt}.png`);

        const captchaText = await solveCaptcha(imgBuffer);

        if (captchaText) {
          console.log(`✅ 识别结果: "${captchaText}"`);

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
          console.log("❌ 识别为空，跳过填入");
        }
      }

      // 点击 Extend time
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

      if (isBlank) {
        console.log(`⚠️  [${attempt}] 验证码为空，重试...`);
      } else if (isWrong || isWrong2) {
        console.log(`⚠️  [${attempt}] 验证码错误，重试...`);
      } else {
        console.log("🔄 无错误提示，刷新确认 Auto-stop 时间...");
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        const autoStopAfter = await getAutoStopSeconds(page);

        if (autoStopAfter > 0) {
          console.log(`🎉 续期成功！Auto-stop 已变为 ${autoStopAfter} 秒`);
          success = true;
          break;
        } else {
          console.log(`😐 Auto-stop 仍为零，重试...`);
        }
      }

      if (attempt < MAX_TRIES) {
        console.log("🔄 刷新获取新验证码...");
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        await page.waitForSelector('text=Extend time', { timeout: 10000 }).catch(() => {});
      }
    }

    if (!success) {
      console.log("\n⚠️  3次尝试后未确认续期成功");
    }

    // ============================================================
    // 最终状态截图 + 开机逻辑
    // ============================================================
    await page.screenshot({ path: 'final_status.png', fullPage: true });

    if (!success) {
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
    }

    const offlineSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-heading > span:nth-child(2)';
    const statusElement = page.locator(offlineSelector);

    let finalStatus = "";
    for (let i = 0; i < 10; i++) {
      finalStatus = await statusElement.innerText().catch(() => "");
      finalStatus = finalStatus.toLowerCase().trim();
      if (finalStatus === "connecting..." || finalStatus === "") {
        console.log(`⏳ 状态 "${finalStatus}"，等待 2 秒... (${i + 1}/10)`);
        await page.waitForTimeout(2000);
      } else {
        break;
      }
    }

    console.log(`📡 最终状态: "${finalStatus}"`);

    if (finalStatus.includes('offline')) {
      console.log("⚠️  服务器 offline，准备开机...");
      const startBtn = page.locator('body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-body > button:nth-child(1)');
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 已点击 Start！");
        await page.waitForTimeout(8000);
      } else {
        console.log("❌ Start 按钮不可见");
      }
    } else if (finalStatus.includes('online')) {
      console.log("✨ 服务器在线，无需开机。");
    } else if (finalStatus.includes('starting')) {
      console.log("🔄 服务器启动中，正常。");
    } else {
      console.log(`🤔 未知状态: "${finalStatus}"`);
    }

  } catch (err) {
    console.error("❌ 执行出错:", err.message);
    await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
