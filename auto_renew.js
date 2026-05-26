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
// 读取 Auto-stop 倒计时（判断续期是否成功的依据）
// 截图中格式：Auto-stop 00:00:00 或 Auto-stop 00:14:25
// 返回秒数，全零返回 0
// ============================================================
async function getAutoStopSeconds(page) {
  try {
    const bodyText = await page.locator('body').innerText();
    // 匹配 "Auto-stop" 后面紧跟的时间，格式 HH:MM:SS
    const match = bodyText.match(/Auto-stop\s+(\d{2}):(\d{2}):(\d{2})/);
    if (!match) return -1; // 找不到说明页面结构有问题
    const seconds = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
    console.log(`⏱️  Auto-stop 倒计时: ${match[1]}:${match[2]}:${match[3]} (${seconds}秒)`);
    return seconds;
  } catch {
    return -1;
  }
}

// ============================================================
// 主流程
// ============================================================
(async () => {
  const useProxy = !!process.env.USE_PROXY;
  console.log(`🌐 代理模式: ${useProxy ? '启用 socks5://127.0.0.1:10808' : '直连'}`);

  const browser = await chromium.launch({
    headless: true,
    ...(useProxy ? { proxy: { server: 'socks5://127.0.0.1:10808' } } : {})
  });

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

    // 读取续期前的 Auto-stop 时间
    const autoStopBefore = await getAutoStopSeconds(page);

    // ============================================================
    // 最多重试 3 次
    // ============================================================
    const MAX_TRIES = 3;
    let success = false;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      console.log(`\n🔁 第 ${attempt}/${MAX_TRIES} 次尝试...`);

      // 检测验证码
      const captchaImg = page.locator('img[src*="captcha"]').first();
      const hasCaptcha = await captchaImg.isVisible().catch(() => false);
      console.log(`🔎 验证码: ${hasCaptcha ? '有' : '无'}`);

      if (hasCaptcha) {
        const imgBuffer = await captchaImg.screenshot();
        await fs.writeFile(`captcha_attempt${attempt}.png`, imgBuffer);
        console.log(`📸 验证码截图已保存: captcha_attempt${attempt}.png`);

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

          console.log(filled ? `✅ 验证码已填入 (${filled})` : "❌ 未找到输入框");
          await page.waitForTimeout(500);
        } else {
          console.log("❌ 识别为空，本次跳过");
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

      // 检查错误提示
      const isBlank = await page.locator('text=Captcha cannot be blank').isVisible().catch(() => false);
      const isWrong = await page.locator('text=The verification code is incorrect').isVisible().catch(() => false);
      const isWrong2 = await page.locator('text=Wrong captcha').isVisible().catch(() => false);

      if (isBlank) {
        console.log(`⚠️  [第${attempt}次] 验证码为空提示，重试...`);
      } else if (isWrong || isWrong2) {
        console.log(`⚠️  [第${attempt}次] 验证码错误提示，重试...`);
      } else {
        // 没有错误提示 → 刷新页面检查 Auto-stop 是否从 00:00:00 变成非零
        console.log("🔄 无错误提示，刷新页面检查 Auto-stop 时间...");
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        const autoStopAfter = await getAutoStopSeconds(page);

        if (autoStopAfter > 0) {
          console.log(`🎉 续期成功！Auto-stop 已从 00:00:00 变为非零 (${autoStopAfter}秒)`);
          success = true;
          break;
        } else if (autoStopBefore > 0 && autoStopAfter > autoStopBefore + 60) {
          console.log(`🎉 续期成功！Auto-stop 时间增加了 ${autoStopAfter - autoStopBefore} 秒`);
          success = true;
          break;
        } else {
          console.log(`😐 Auto-stop 仍为零或未增加（${autoStopAfter}秒），重试...`);
        }
      }

      // 非最后一次 → 刷新获取新验证码
      if (attempt < MAX_TRIES) {
        console.log("🔄 刷新页面获取新验证码...");
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        await page.waitForSelector('text=Extend time', { timeout: 10000 }).catch(() => {});
      }
    }

    if (!success) {
      console.log("\n⚠️  3次尝试后未确认续期成功");
    }

    // ============================================================
    // 最终截图 + 状态检测 + 开机
    // ============================================================
    await page.screenshot({ path: 'final_status.png', fullPage: true });
    console.log("📸 最终截图: final_status.png");

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
      console.log("🔄 服务器启动中 (starting)，正常。");
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
