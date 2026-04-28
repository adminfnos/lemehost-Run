# lemehost-Run

获取 Cookies:   
登录 lemehost.com按 F12 打开开发者工具点击 Application → Cookies → https://lemehost.com      
新建 MY_COOKIES，内容格式如下（请根据你实际抓到的 cookie 修改）：   
```
[
  { "name": "_csrf-frontend", "value": "填入你的值", "domain": "lemehost.com", "path": "/" },
  { "name": "_identity-frontend", "value": "填入你的值", "domain": "lemehost.com", "path": "/" },
  { "name": "advanced-frontend", "value": "填入你的值", "domain": "lemehost.com", "path": "/" }
]
```

Cron-job.org 触发：

你需要创建一个 Fine-grained Personal Access Token (PAT)，权限给到 Contents: Read & Write 和 Metadata: Read。

在 cron-job.org 中设置 POST 请求：

URL: https://api.github.com/repos/你的用户名/仓库名/dispatches

Header: * Accept: application/vnd.github.v3+json

Authorization: Bearer 你的PAT密钥

User-Agent: Cron-Job-Client

Body (JSON):      
```
{"event_type": "cron_trigger"}
```
