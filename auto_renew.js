const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  // 加载 Cookie
  const cookies = JSON.parse(process.env.MY_COOKIES);
  await context.addCookies(cookies);

  const page = await context.newPage();
  const url = 'https://lemehost.com/server/10131731/free-plan';

  try {
    console.log("正在访问页面，准备检查服务器状态...");
    // 访问页面，等待基础 DOM 加载完毕
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 使用你提供的红点状态身份证号
    const offlineSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-heading > span:nth-child(2)';
    const statusElement = page.locator(offlineSelector);

    console.log("正在等待状态检测 (处理 connecting... 情况)...");

    let finalStatus = "";
    // 循环检测，防止卡在 "connecting..." 状态
    for (let i = 0; i < 10; i++) {
      finalStatus = await statusElement.innerText().catch(() => "");
      finalStatus = finalStatus.toLowerCase().trim();
      
      if (finalStatus === "connecting..." || finalStatus === "") {
        console.log(`当前显示 "${finalStatus || '加载中'}"，等待 2 秒... (${i+1}/10)`);
        await page.waitForTimeout(2000);
      } else {
        break; // 状态已更新，退出循环
      }
    }

    console.log(`最终确认状态为: "${finalStatus}"`);

    // 执行开机逻辑
    if (finalStatus.includes('offline')) {
      console.log("⚠️ 检测到服务器处于 offline 状态，正在执行精准开机...");
      
      // 使用你提供的 Start 按钮身份证号
      const startBtnSelector = 'body > div > div > div.server-view > div > div.col-md-3 > div > div.panel-body > button:nth-child(1)';
      const startBtn = page.locator(startBtnSelector);
      
      if (await startBtn.isVisible()) {
        await startBtn.click();
        console.log("🚀 Start 按钮已精准点击！");
        // 留出时间让请求发送完毕
        await page.waitForTimeout(5000); 
      } else {
        console.log("❌ 找到了 offline 标志，但 Start 按钮无法点击。");
      }
    } else if (finalStatus.includes('online')) {
      console.log("✨ 服务器当前为 Online 状态，无需操作。");
    } else {
      console.log(`🤔 状态为 "${finalStatus}"，未触发开机逻辑。`);
    }

  } catch (err) {
    console.error("❌ 执行出错:", err.message);
  } finally {
    await browser.close();
  }
})();
