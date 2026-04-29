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
    
    // 截图 1：刚进入页面的样子
    await page.screenshot({ path: '1_initial_page.png', fullPage: true });

    const offlineSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-heading > span:nth-child(2)';
    const statusElement = page.locator(offlineSelector);

    console.log("等待状态从 connecting... 切换...");
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
      const startBtnSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-body > button:nth-child(1)';
      const startBtn = page.locator(startBtnSelector);
      
      if (await startBtn.isVisible()) {
        console.log("准备点击 Start 按钮...");
        // 截图 2：准备点击前的状态
        await page.screenshot({ path: '2_before_click.png' });
        
        await startBtn.click({ force: true });
        console.log("🚀 Start 按钮已点击！等待服务器响应...");
        
        // 点击后等 10 秒，看看网页有没有变化
        await page.waitForTimeout(10000); 
        
        // 截图 3：点击后的最终状态（看看有没有报错信息弹出来）
        await page.screenshot({ path: '3_after_click.png', fullPage: true });
      } else {
        console.log("❌ 按钮不可见！");
        await page.screenshot({ path: 'error_no_button.png' });
      }
    } else {
      console.log("✨ 服务器在线，无需操作。");
    }

  } catch (err) {
    console.error("❌ 出错:", err.message);
    await page.screenshot({ path: 'error_exception.png' });
  } finally {
    await browser.close();
  }
})();
