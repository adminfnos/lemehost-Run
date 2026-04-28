const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  try {
    const cookies = JSON.parse(process.env.MY_COOKIES);
    await context.addCookies(cookies);
  } catch (e) {
    console.error("Cookie 解析失败");
    process.exit(1);
  }

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

    // 2. 刷新并检查状态
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log("🔄 页面已刷新，正在精准检测服务器状态...");

    // 优化后的判断逻辑：
    // 我们同时查找文本 "offline" (不区分大小写) 和那个红点标志
    const isOffline = await page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      // 检查是否包含 offline 关键字
      return bodyText.includes('offline');
    });

    if (isOffline) {
      console.log("⚠️ 确认服务器处于离线状态，准备点火开机...");
      
      // 尝试多种可能的 Start 按钮选择器
      const startBtn = page.locator('button:has-text("Start"), .btn-success:has-text("Start"), .btn:has-text("Start")');
      
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 开机指令已发出！");
        await page.waitForTimeout(5000); // 给系统一点反应时间
      } else {
        console.log("❌ 找到了 offline 状态，但没找到 Start 按钮，请检查页面是否有弹窗遮挡。");
      }
    } else {
      console.log("✨ 服务器当前显示为 Online，跳过开机步骤。");
    }

  } catch (err) {
    console.error("运行出错:", err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
