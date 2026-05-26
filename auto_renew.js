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
    console.log(`🔤 Tesseract 识别: "${text.trim()}" → "${result}"`);
    return result || null;
  } catch (err) {
    console.error("❌ Tesseract 识别失败:", err.message);
    return null;
  }
}

// ============================================================
// 解析页面上的续期剩余时间（秒），用于判断续期是否成功
// ============================================================
async function getRenewTimeSeconds(page) {
  try {
    // Free Plan 倒计时文字，格式如 "3d 22:42:16" 或 "00:14:25"
    const timeText = await page.locator('.free-plan-remaining, [class*="free"] .time, td:has-text("Free Plan") + td').first().innerText().catch(() => '');
    // 兜底：直接从页面文本找时间格式
    const bodyText = await page.locator('body').innerText().catch(() => '');
    // 匹配 "Xd HH:MM:SS" 或 "HH:MM:SS"
    const match = bodyText.match(/(\d+d\s+)?(\d{2}):(\d{2}):(\d{2})/);
    if (!match) return 0;
    const days = match[1] ? parseInt(match[1]) : 0;
    const h = parseInt(match[2]), m = parseInt(match[3]), s = parseInt(match[4]);
    return days * 86400 + h * 3600 + m * 60 + s;
  } catch {
    return 0;
  }
}

// ============================================================
// 获取垃圾桶图标旁边的删除倒计时（更稳定），格式 "3d 22:42:16"
// ============================================================
async function getDeleteCountdown(page) {
  try {
    // 根据截图，删除倒计时在垃圾桶图标旁边，如 "3d 22:42:16"
    const allText = await page.locator('body').innerText();
    // 匹配形如 "3d 22:42:16" 的删除倒计时
    const matches = [...allText.matchAll(/(\d+)d\s+(\d{2}):(\d{2}):(\d{2})/g)];
    if (matches.length === 0) return 0;
    // 取第一个匹配（删除倒计时）
    const m = matches[0];
    return parseInt(m[1]) * 86400 + parseInt(m[2]) * 3600 + parseInt(m[3]) * 60 + parseInt(m[4]);
  } catch {
    return 0;
  }
}

// ============================================================
// 主流程
// ============================================================
(async () => {
  // 检查是否配置了代理
  const useProxy = !!process.env.USE_PROXY;
  console.log(`🌐 代理模式: ${useProxy ? '启用 socks5://127.0.0.1:10808' : '直连'}`);

  const browser = await chromium.launch({
    headless: true,
    // 如果 workflow 启动了 xray，Playwright 走本地 socks5 代理
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

    // 等待 Extend time 按钮出现
    await page.waitForSelector('text=Extend time', { timeout: 15000 }).catch(() => {
      console.log("⚠️  等待 Extend time 按钮超时，继续...");
    });

    // 记录续期前的删除倒计时（作为基准）
    const timeBefore = await getDeleteCountdown(page);
    console.log(`⏱️  续期前删除倒计时: ${timeBefore} 秒`);

    // ============================================================
    // 验证码处理 + 续期，最多重试 3 次
    // ============================================================
    const MAX_TRIES = 3;
    let success = false;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      console.log(`\n🔁 第 ${attempt}/${MAX_TRIES} 次尝试续期...`);

      // 检测验证码
      const captchaImg = page.locator('img[src*="captcha"]').first();
      const hasCaptcha = await captchaImg.isVisible().catch(() => false);
      console.log(`🔎 验证码: ${hasCaptcha ? '有' : '无'}`);

      if (hasCaptcha) {
        // 截取验证码图片
        const imgBuffer = await captchaImg.screenshot();
        await fs.writeFile(`captcha_attempt${attempt}.png`, imgBuffer);
        console.log(`📸 验证码截图: captcha_attempt${attempt}.png`);

        const captchaText = await solveCaptcha(imgBuffer);

        if (captchaText) {
          console.log(`✅ 识别结果: "${captchaText}"`);

          // 填入验证码
          const filled = await page.evaluate((code) => {
            const targets = [
              document.querySelector('input[name="captcha"]'),
              document.querySelector('.field-captcha input'),
              Array.from(document.querySelectorAll('input[type="text"],input:not([type])')).find(i => !i.value)
            ];
            const inp = targets.find(Boolean);
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
          console.log("❌ 验证码识别为空，本次跳过填入");
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

      // 截图记录点击后状态
      await page.screenshot({ path: `after_extend_attempt${attempt}.png`, fullPage: true });

      // 检查是否有错误提示
      const isBlank = await page.locator('text=Captcha cannot be blank').isVisible().catch(() => false);
      const isWrong = await page.locator('text=The verification code is incorrect').isVisible().catch(() => false);
      const isWrong2 = await page.locator('text=Wrong captcha').isVisible().catch(() => false);

      if (isBlank) {
        console.log(`⚠️  [第${attempt}次] 验证码为空，刷新重试...`);
      } else if (isWrong || isWrong2) {
        console.log(`⚠️  [第${attempt}次] 验证码错误，刷新重试...`);
      } else {
        // 没有错误提示，可能成功了，刷新页面确认时间
        console.log("🔄 无错误提示，刷新页面确认续期结果...");
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);

        const timeAfter = await getDeleteCountdown(page);
        console.log(`⏱️  续期后删除倒计时: ${timeAfter} 秒`);

        if (timeAfter > timeBefore + 60) {
          // 时间增加超过 60 秒，续期成功
          console.log(`🎉 续期成功！时间增加了 ${timeAfter - timeBefore} 秒`);
          success = true;
          break;
        } else {
          console.log(`😐 时间未明显增加（前: ${timeBefore}s，后: ${timeAfter}s），可能验证码仍有问题，重试...`);
        }
      }

      // 如果不是最后一次，刷新页面获取新验证码再试
      if (attempt < MAX_TRIES) {
        console.log("🔄 刷新页面获取新验证码...");
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        await page.waitForSelector('text=Extend time', { timeout: 10000 }).catch(() => {});
      }
    }

    if (!success) {
      console.log("\n⚠️  3次尝试均未确认续期成功，以最终状态为准继续执行...");
    }

    // ============================================================
    // 最终截图 + 状态检测
    // ============================================================
    await page.screenshot({ path: 'final_status.png', fullPage: true });
    console.log("📸 最终截图: final_status.png");

    // 确保在最新状态的页面上读取
    if (success) {
      // 已在刷新后的页面，直接读
    } else {
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
      console.log(`🤔 未知状态 "${finalStatus}"。`);
    }

  } catch (err) {
    console.error("❌ 执行出错:", err.message);
    await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
