# lemehost-Run  

VLESS_URL

Application → Cookies → https://lemehost.com      
新建 MY_COOKIES，内容格式如下（请根据你实际抓到的 cookie 修改）：   
```
[
  { "name": "_csrf-frontend", "value": "填入你的值", "domain": "lemehost.com", "path": "/" },
  { "name": "_identity-frontend", "value": "填入你的值", "domain": "lemehost.com", "path": "/" },
  { "name": "advanced-frontend", "value": "填入你的值", "domain": "lemehost.com", "path": "/" }
]
```

Cron-job.org 触发：


URL: https://api.github.com/repos/你的用户名/仓库名/dispatches

Header: * Accept: application/vnd.github.v3+json

Authorization: Bearer 你的PAT密钥

User-Agent: Cron-Job-Client

Body (JSON):      
```
{"event_type": "cron_trigger"}
```
