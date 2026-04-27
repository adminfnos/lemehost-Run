# lemehost-Run

获取 Cookies:   
登录 lemehost.com按 F12 打开开发者工具点击 Application → Cookies → https://lemehost.com      
_csrf-frontend    
_identity-frontend    
advanced-frontend    
source    

添加变量:   
CSRF_TOKEN=_csrf-frontend 的 Value    
IDENTITY_TOKEN= _identity-frontend 的 Value    
ADVANCED_TOKEN= advanced-frontend 的 Value    
SOURCE_TOKEN= source 的 Value    
SERVER_ID= 10131731（从网址里取）  


cron-job.org 设置定时触发   
URL：
```
https://api.github.com/repos/你的GitHub用户名/auto-start-server/dispatches
```
点开 Advanced / Headers，添加：   
Authorization=Bearer 你刚才复制的Token     
Accept=application/vnd.github.v3+json   
Content-Type=application/json   
Request body（请求体）：   
```
{"event_type": "start-server"}

