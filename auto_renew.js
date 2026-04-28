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
    console.error("Cookie 格式解析失败，请检查 GitHub Secrets 设置:", e.message);
    process.exit(1);
  }

  const page = await context.newPage();
  const url = 'https://lemehost.com/server/10131731/free-plan';

  try {
    console.log("正在访问页面 (设置 60s 超时)...");
    
    // 关键修改：将等待条件改为 domcontentloaded，并增加超时时间
    await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 60000 
    });

    console.log("页面基础架构已加载，开始查找按钮...");

    // 1. 点击 Extend time
    // 增加一点等待，确保按钮能被找到
    const extendBtn = page.locator('text=Extend time');
    await extendBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => console.log("未看到 Extend time 按钮"));
    
    if (await extendBtn.isVisible()) {
      await extendBtn.click();
      console.log("✅ 已点击 Extend time");
      await page.waitForTimeout(3000); 
    }

    // 2. 刷新页面
    await page.reload({ waitUntil: 'domcontentloaded' });
    console.log("🔄 页面已刷新");

    // 3. 检查状态并开机
    const statusText = await page.innerText('body');
    if (statusText.includes('offline')) {
      console.log("⚠️ 检测到 offline，正在尝试点击 Start...");
      const startBtn = page.locator('button:has-text("Start"), .btn-success:has-text("Start")');
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 已点击 Start 按钮");
        await page.waitForTimeout(2000);
      }
    } else {
      console.log("✨ 服务器当前处于 Online 状态。");
    }

  } catch (err) {
    console.error("执行过程中报错:", err.message);
    // 如果超时了，截个图看看页面到底卡在哪了
    await page.screenshot({ path: 'timeout_debug.png' });
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
