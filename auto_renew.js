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

    const offlineSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-heading > span:nth-child(2)';
    const statusElement = page.locator(offlineSelector);

    console.log("等待状态加载...");
    let finalStatus = "";
    for (let i = 0; i < 10; i++) {
      finalStatus = await statusElement.innerText().catch(() => "");
      finalStatus = finalStatus.toLowerCase().trim();
      if (finalStatus === "connecting..." || finalStatus === "") {
        await page.waitForTimeout(2000);
      } else {
        break;
      }
    }

    console.log(`最终确认状态: "${finalStatus}"`);

    if (finalStatus.includes('offline')) {
      console.log("⚠️ 离线状态确认，尝试强力开启...");
      
      const startBtnSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-body > button:nth-child(1)';
      const startBtn = page.locator(startBtnSelector);
      
      if (await startBtn.isVisible()) {
        // --- 核心优化：双重强制点击 ---
        // 1. 先确保按钮滚动到视野内
        await startBtn.scrollIntoViewIfNeeded();
        // 2. 第一次点击（尝试唤醒）
        await startBtn.click({ force: true });
        await page.waitForTimeout(1000);
        // 3. 第二次点击（确认执行）
        await startBtn.click({ force: true });
        
        console.log("🚀 Start 按钮已执行双重强力点击！");
        
        // 关键：点击后等待 10 秒，让网页有足够时间发送 Ajax 请求给后端
        await page.waitForTimeout(10000); 
        
        // 最后截个图看看点完之后网页上有没有弹出什么报错提醒
        await page.screenshot({ path: 'after_click.png' });
      } else {
        console.log("❌ 按钮不可见，无法点击。");
      }
    } else {
      console.log("✨ 服务器是在线状态。");
    }

  } catch (err) {
    console.error("❌ 出错:", err.message);
  } finally {
    await browser.close();
  }
})();
