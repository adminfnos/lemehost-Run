const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');

// ============================================================
// Tesseract.js 识别验证码函数（不依赖 Jimp，直接处理 Buffer）
// ============================================================
async function solveCaptchaWithTesseract(imageBuffer) {
  try {
    console.log("🔍 正在用 Tesseract.js 识别验证码...");

    const { data: { text } } = await Tesseract.recognize(imageBuffer, 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    });

    const result = text.replace(/[^a-zA-Z0-9]/g, '').trim();
    console.log(`🔤 Tesseract 原始结果: "${text.trim()}" → 清洗后: "${result}"`);
    return result || null;

  } catch (err) {
    console.error("❌ Tesseract 识别失败:", err.message);
    return null;
  }
}

// ============================================================
// 主流程
// ============================================================
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const cookies = JSON.parse(process.env.MY_COOKIES);
  await context.addCookies(cookies);

  const page = await context.newPage();
  const url = 'https://lemehost.com/server/10131731/free-plan';

  try {
    console.log("🌐 正在访问页面...");
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // ============================================================
    // 检测验证码
    // ============================================================
    const captchaLabel = page.locator('text=Captcha');
    const hasCaptcha = await captchaLabel.isVisible().catch(() => false);
    console.log(`🔎 验证码检测结果: ${hasCaptcha ? '有验证码' : '无验证码'}`);

    if (hasCaptcha) {
      console.log("⚠️  检测到验证码，开始处理...");

      // 定位验证码图片（已确认 img[src*="captcha"] 有效）
      const captchaImgLocator = page.locator('img[src*="captcha"]').first();

      let captchaText = null;

      if (await captchaImgLocator.isVisible().catch(() => false)) {
        const imgBuffer = await captchaImgLocator.screenshot();
        await require('fs').promises.writeFile('captcha_raw.png', imgBuffer);
        console.log("📸 验证码原图已保存: captcha_raw.png");
        captchaText = await solveCaptchaWithTesseract(imgBuffer);
      } else {
        console.log("❌ 找不到验证码图片元素");
      }

      if (captchaText) {
        console.log(`✅ 识别到验证码: "${captchaText}"`);

        // 用 page.evaluate 直接操作 DOM 填入验证码，绕过选择器问题
        const filled = await page.evaluate((code) => {
          // 找所有 input 框，优先找 name=captcha 或在 .field-captcha 里的
          const byName = document.querySelector('input[name="captcha"]');
          if (byName) { byName.value = code; byName.dispatchEvent(new Event('input', { bubbles: true })); return 'input[name=captcha]'; }

          const byClass = document.querySelector('.field-captcha input');
          if (byClass) { byClass.value = code; byClass.dispatchEvent(new Event('input', { bubbles: true })); return '.field-captcha input'; }

          // 兜底：找 Captcha label 后面的 input
          const labels = Array.from(document.querySelectorAll('label, span, div'));
          for (const el of labels) {
            if (el.textContent.trim() === 'Captcha' || el.textContent.includes('Captcha')) {
              const parent = el.closest('.form-group') || el.parentElement;
              if (parent) {
                const inp = parent.querySelector('input');
                if (inp) { inp.value = code; inp.dispatchEvent(new Event('input', { bubbles: true })); return 'label-sibling input'; }
              }
            }
          }

          // 最终兜底：页面上所有 text 类型 input，取最后一个空的
          const allInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
          const emptyInput = allInputs.find(i => !i.value);
          if (emptyInput) { emptyInput.value = code; emptyInput.dispatchEvent(new Event('input', { bubbles: true })); return 'fallback empty input'; }

          return null;
        }, captchaText);

        if (filled) {
          console.log(`✅ 验证码已通过 DOM 填入（方式: ${filled}）`);
        } else {
          console.log("❌ 所有方式均未找到验证码输入框");
        }

        await page.waitForTimeout(800);

      } else {
        console.log("❌ 验证码识别结果为空，跳过填入...");
      }
    }

    // ============================================================
    // 点击 Extend time 按钮
    // ============================================================
    const extendBtn = page.locator('text=Extend time');
    if (await extendBtn.isVisible()) {
      await extendBtn.click();
      console.log("✅ 已点击 Extend time");
      await page.waitForTimeout(5000);
    } else {
      console.log("❌ 未找到 Extend time 按钮");
    }

    // 截图：点击续期后
    await page.screenshot({ path: 'after_extend.png', fullPage: true });
    console.log("📸 截图已保存: after_extend.png");

    // ============================================================
    // 检查是否出现"Captcha cannot be blank"或其他错误提示
    // ============================================================
    const captchaError = await page.locator('text=Captcha cannot be blank').isVisible().catch(() => false);
    const captchaWrong = await page.locator('text=Wrong captcha').isVisible().catch(() => false);
    if (captchaError) console.log("⚠️  提示：验证码不能为空（填入失败或识别为空）");
    if (captchaWrong) console.log("⚠️  提示：验证码错误（识别内容不正确）");

    // ============================================================
    // 刷新页面，等待状态切换
    // ============================================================
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log("🔄 页面已刷新，等待状态切换...");

    const offlineSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-heading > span:nth-child(2)';
    const statusElement = page.locator(offlineSelector);

    let finalStatus = "";
    for (let i = 0; i < 10; i++) {
      finalStatus = await statusElement.innerText().catch(() => "");
      finalStatus = finalStatus.toLowerCase().trim();
      if (finalStatus === "connecting..." || finalStatus === "") {
        console.log(`⏳ 状态仍为 "${finalStatus}"，等待 2 秒... (${i + 1}/10)`);
        await page.waitForTimeout(2000);
      } else {
        break;
      }
    }

    console.log(`📡 最终状态: "${finalStatus}"`);

    // ============================================================
    // 根据状态开机
    // ============================================================
    if (finalStatus.includes('offline')) {
      console.log("⚠️  服务器 offline，准备开机...");
      const startBtnSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-body > button:nth-child(1)';
      const startBtn = page.locator(startBtnSelector);
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 已点击 Start，服务器启动中...");
        await page.waitForTimeout(8000);
      } else {
        console.log("❌ Start 按钮不可见");
      }
    } else if (finalStatus.includes('online')) {
      console.log("✨ 服务器已在线，无需开机。");
    } else {
      console.log(`🤔 未知状态 "${finalStatus}"，不执行开机。`);
    }

  } catch (err) {
    console.error("❌ 执行出错:", err.message);
    await page.screenshot({ path: 'error.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
