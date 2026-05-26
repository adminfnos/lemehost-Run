const { chromium } = require('playwright');
const Tesseract = require('tesseract.js');
const Jimp = require('jimp');

// ============================================================
// Tesseract.js 识别验证码函数（完全免费，无需 API Key）
// ============================================================
async function solveCaptchaWithTesseract(imageBuffer) {
  try {
    console.log("🔍 正在用 Tesseract.js 识别验证码...");

    const image = await Jimp.read(imageBuffer);
    image
      .resize(image.bitmap.width * 3, image.bitmap.height * 3)
      .greyscale()
      .contrast(0.5)
      .threshold({ max: 128 });

    const processedBuffer = await image.getBufferAsync(Jimp.MIME_PNG);

    const { data: { text } } = await Tesseract.recognize(processedBuffer, 'eng', {
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    });

    const result = text.replace(/[^a-zA-Z0-9]/g, '').trim();
    console.log(`🔤 Tesseract 原始识别结果: "${text.trim()}" → 清洗后: "${result}"`);
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
    // 📸 截图1：页面加载后的初始状态
    // ============================================================
    await page.screenshot({ path: '01_page_loaded.png', fullPage: true });
    console.log("📸 截图已保存: 01_page_loaded.png");

    // ============================================================
    // 打印页面所有可见文本，帮助诊断验证码检测问题
    // ============================================================
    const bodyText = await page.locator('body').innerText().catch(() => '');
    console.log("📄 页面文本内容片段:", bodyText.substring(0, 500));

    // ============================================================
    // 检测验证码：同时检测多种可能的文本（英文/大小写）
    // ============================================================
    const captchaSelectors = [
      'text=Captcha',
      'text=captcha',
      'text=CAPTCHA',
      'label:has-text("Captcha")',
      '.field-captcha',
      '[class*="captcha"]',
    ];

    let hasCaptcha = false;
    let matchedCaptchaSelector = '';
    for (const sel of captchaSelectors) {
      const visible = await page.locator(sel).first().isVisible().catch(() => false);
      if (visible) {
        hasCaptcha = true;
        matchedCaptchaSelector = sel;
        break;
      }
    }

    console.log(`🔎 验证码检测结果: ${hasCaptcha ? '有验证码，匹配选择器: ' + matchedCaptchaSelector : '无验证码'}`);

    if (hasCaptcha) {
      console.log("⚠️  检测到验证码，开始处理...");

      // 按优先级依次尝试定位验证码图片元素
      const captchaImgSelectors = [
        '.captcha-img',
        'img[src*="captcha"]',
        '.field-captcha img',
        '.captcha img',
        'img[alt*="captcha"]',
        'img[alt*="Captcha"]',
      ];

      let captchaImgLocator = null;
      for (const selector of captchaImgSelectors) {
        const locator = page.locator(selector).first();
        if (await locator.isVisible().catch(() => false)) {
          captchaImgLocator = locator;
          console.log(`✅ 找到验证码图片元素：${selector}`);
          break;
        }
      }

      // 打印所有 img 标签的 src，帮助找到验证码图片
      const allImgSrcs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('img')).map(img => img.src + ' | class=' + img.className)
      );
      console.log("🖼️  页面所有图片:", JSON.stringify(allImgSrcs));

      let captchaText = null;

      if (captchaImgLocator) {
        // 方式1：精准截取验证码图片元素
        const imgBuffer = await captchaImgLocator.screenshot();
        await require('fs').promises.writeFile('02_captcha_crop.png', imgBuffer);
        console.log("📸 验证码图片已保存: 02_captcha_crop.png");
        captchaText = await solveCaptchaWithTesseract(imgBuffer);
      } else {
        // 方式2：截取整个页面后识别（兜底方案）
        console.log("⚠️  未找到独立验证码图片元素，截取整页识别...");
        const pageBuffer = await page.screenshot({ fullPage: false });
        captchaText = await solveCaptchaWithTesseract(pageBuffer);
      }

      if (captchaText) {
        console.log(`✅ 识别到验证码: "${captchaText}"`);

        // 定位验证码输入框并填入
        const inputSelectors = [
          'input[name="captcha"]',
          '.field-captcha input',
          'input[placeholder*="aptcha"]',
          'input[placeholder*="验证码"]',
          'input[type="text"]:last-of-type',
        ];

        let filled = false;
        for (const selector of inputSelectors) {
          const input = page.locator(selector).first();
          if (await input.isVisible().catch(() => false)) {
            await input.fill(captchaText);
            console.log(`✅ 验证码已填入输入框（选择器：${selector}）`);
            filled = true;
            break;
          }
        }

        if (!filled) {
          console.log("❌ 未找到验证码输入框，尝试直接点击 Extend time...");
        }

        // 📸 截图3：填完验证码后
        await page.screenshot({ path: '03_after_captcha_fill.png', fullPage: true });
        console.log("📸 截图已保存: 03_after_captcha_fill.png");

        await page.waitForTimeout(1000);

      } else {
        console.log("❌ 验证码识别结果为空，跳过填入...");
        // 📸 截图：识别失败时的状态
        await page.screenshot({ path: '03_captcha_recognition_failed.png', fullPage: true });
      }

    } else {
      console.log("✅ 本次无验证码，直接续期");
    }

    // ============================================================
    // 点击 Extend time 按钮
    // ============================================================
    const extendBtn = page.locator('text=Extend time');
    if (await extendBtn.isVisible()) {
      await extendBtn.click();
      console.log("✅ 已点击 Extend time");
      await page.waitForTimeout(5000);

      // 📸 截图4：点击续期后
      await page.screenshot({ path: '04_after_extend_click.png', fullPage: true });
      console.log("📸 截图已保存: 04_after_extend_click.png");
    } else {
      console.log("❌ 未找到 Extend time 按钮");
      await page.screenshot({ path: '04_extend_btn_not_found.png', fullPage: true });
    }

    // ============================================================
    // 刷新页面，等待状态从 connecting... 变化
    // ============================================================
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log("🔄 页面已刷新，正在等待状态切换...");

    const offlineSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-heading > span:nth-child(2)';
    const statusElement = page.locator(offlineSelector);

    let finalStatus = "";
    for (let i = 0; i < 10; i++) {
      finalStatus = await statusElement.innerText().catch(() => "");
      finalStatus = finalStatus.toLowerCase().trim();

      if (finalStatus === "connecting..." || finalStatus === "") {
        console.log(`⏳ 当前状态仍为 "${finalStatus}"，等待 2 秒再试... (${i + 1}/10)`);
        await page.waitForTimeout(2000);
      } else {
        break;
      }
    }

    console.log(`📡 最终探测到的状态为: "${finalStatus}"`);

    // 📸 截图5：最终状态
    await page.screenshot({ path: '05_final_status.png', fullPage: true });
    console.log("📸 截图已保存: 05_final_status.png");

    // ============================================================
    // 根据状态决定是否开机
    // ============================================================
    if (finalStatus.includes('offline')) {
      console.log("⚠️  确认服务器处于 offline 状态，准备开机...");
      const startBtnSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-body > button:nth-child(1)';
      const startBtn = page.locator(startBtnSelector);

      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 Start 按钮已点击！服务器正在启动...");
        await page.waitForTimeout(8000);
        await page.screenshot({ path: '06_after_start.png', fullPage: true });
        console.log("📸 截图已保存: 06_after_start.png");
      } else {
        console.log("❌ 虽为离线，但 Start 按钮不可见。");
      }
    } else if (finalStatus.includes('online')) {
      console.log("✨ 服务器已是在线 (Online) 状态，无需开机。");
    } else {
      console.log(`🤔 探测到未知状态 "${finalStatus}"，为安全起见不执行开机。`);
    }

  } catch (err) {
    console.error("❌ 执行出错:", err.message);
    // 📸 出错时也截图
    await page.screenshot({ path: 'error_screenshot.png', fullPage: true }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
