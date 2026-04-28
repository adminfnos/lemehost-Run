const { chromium } = require('playwright');

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
    console.log("正在访问页面...");
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // --- 第一步：延长续期 ---
    const extendBtn = page.locator('text=Extend time');
    if (await extendBtn.isVisible()) {
      await extendBtn.click();
      console.log("✅ 已点击 Extend time");
      await page.waitForTimeout(5000); 
    }

    // --- 第二步：刷新页面 ---
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log("🔄 页面已刷新，正在通过身份证号检测状态...");

    // --- 第三步：使用你提供的身份证精准检测 ---
    // 红点状态选择器
    const offlineSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-heading > span:nth-child(2)';
    const statusElement = page.locator(offlineSelector);
    
    // 获取状态文字
    const statusText = await statusElement.innerText().catch(() => "");
    console.log(`当前探测到的状态文字为: "${statusText}"`);

    // 判断逻辑：如果文字包含 offline 或者该元素存在
    if (statusText.toLowerCase().includes('offline')) {
      console.log("⚠️ 确认服务器处于 offline 状态，准备开机...");
      
      // 使用你提供的 Start 按钮身份证
      const startBtnSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-body > button:nth-child(1)';
      const startBtn = page.locator(startBtnSelector);
      
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 Start 按钮已精准点击！服务器正在启动...");
        await page.waitForTimeout(8000); 
      } else {
        console.log("❌ 身份证匹配到了 offline，但 Start 按钮在页面上不可见。");
      }
    } else {
      console.log("✨ 状态显示正常，跳过开机步骤。");
    }

  } catch (err) {
    console.error("❌ 执行出错:", err.message);
  } finally {
    await browser.close();
  }
})();
