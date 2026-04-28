const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  // 1. 植入从 Secrets 传入的 Cookie
  const cookies = JSON.parse(process.env.MY_COOKIES);
  await context.addCookies(cookies);

  const page = await context.newPage();
  const url = 'https://lemehost.com/server/10131731/free-plan';

  try {
    console.log("正在访问页面...");
    await page.goto(url, { waitUntil: 'networkidle' });

    // 2. 点击 Extend time
    const extendBtn = page.locator('text=Extend time');
    if (await extendBtn.isVisible()) {
      await extendBtn.click();
      console.log("已点击 Extend time");
      await page.waitForTimeout(2000); // 等待反馈
    }

    // 3. 刷新页面
    await page.reload({ waitUntil: 'networkidle' });
    console.log("页面已刷新");

    // 4. 检查是否 Offline 并尝试 Start
    const offlineIndicator = page.locator('span:has-text("offline")'); 
    // 注意：这里根据你图中的红点判断，如果 offline 是文本，则 locator 生效
    
    if (await offlineIndicator.isVisible()) {
      console.log("检测到服务器离线，正在尝试启动...");
      const startBtn = page.locator('button:has-text("Start")');
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("已点击 Start 按钮");
      }
    } else {
      console.log("服务器在线，无需操作。");
    }

  } catch (err) {
    console.error("执行出错:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
