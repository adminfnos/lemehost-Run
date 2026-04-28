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

    // 1. 延长续期
    const extendBtn = page.locator('text=Extend time');
    if (await extendBtn.isVisible()) {
      await extendBtn.click();
      console.log("✅ 已点击 Extend time");
      await page.waitForTimeout(5000); 
    }

    // 2. 刷新页面
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log("🔄 页面已刷新，正在等待状态从 connecting... 切换...");

    const offlineSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-heading > span:nth-child(2)';
    const statusElement = page.locator(offlineSelector);

    // --- 核心优化：循环等待最终状态 ---
    let finalStatus = "";
    for (let i = 0; i < 10; i++) { // 最多等 20 秒
      finalStatus = await statusElement.innerText().catch(() => "");
      finalStatus = finalStatus.toLowerCase().trim();
      
      if (finalStatus === "connecting..." || finalStatus === "") {
        console.log(`当前状态仍为 "${finalStatus}"，等待 2 秒再试... (${i+1}/10)`);
        await page.waitForTimeout(2000);
      } else {
        break; // 状态变了，退出循环
      }
    }

    console.log(`最终探测到的状态为: "${finalStatus}"`);

    // 3. 判断并开机
    if (finalStatus.includes('offline')) {
      console.log("⚠️ 确认服务器处于 offline 状态，准备开机...");
      const startBtnSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-body > button:nth-child(1)';
      const startBtn = page.locator(startBtnSelector);
      
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 Start 按钮已精准点击！服务器正在启动...");
        await page.waitForTimeout(8000); 
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
  } finally {
    await browser.close();
  }
})();
