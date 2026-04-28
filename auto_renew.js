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

    // 1. 延长续期 (这一步你之前跑通了，保留)
    const extendBtn = page.locator('text=Extend time');
    if (await extendBtn.isVisible()) {
      await extendBtn.click();
      console.log("✅ 已点击 Extend time");
      await page.waitForTimeout(5000); 
    }

    // 2. 刷新并检查状态
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log("🔄 页面已刷新，正在检查红点状态...");

    // 重点：通过 CSS 选择器定位那个红点或 offline 容器
    // 根据截图，它通常是一个带有红色背景或特定 class 的 span
    const offlineDetector = page.locator('span.badge-danger, .text-danger, i.fa-circle.text-danger, span:has-text("offline")');
    
    // 如果上面几种常见的 offline 标志能找到任何一个
    const count = await offlineDetector.count();
    const bodyText = await page.innerText('body');
    const isOffline = count > 0 || bodyText.toLowerCase().includes('offline');

    if (isOffline) {
      console.log(`⚠️ 检测到离线标志 (匹配数: ${count})，准备点击 Start...`);
      
      // 定位 Start 按钮 (使用更强力的选择器)
      const startBtn = page.locator('button:has-text("Start"), a:has-text("Start"), .btn-success:has-text("Start")').first();
      
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 Start 按钮已点击！");
        // 点击后额外等一会，确保指令发出
        await page.waitForTimeout(8000); 
      } else {
        console.log("❌ 确认离线，但没找到 Start 按钮。");
      }
    } else {
      console.log("✨ 未检测到离线标志，服务器应该是 Online 状态。");
    }

  } catch (err) {
    console.error("运行出错:", err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
