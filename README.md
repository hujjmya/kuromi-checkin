# 库洛米每日打卡

面向儿童的每日打卡应用，支持 **网页版** 与 **Android 平板 APK**，共用同一套前端代码。

正在接入 **Supabase 云同步**：家长账号登录后，平板与网页共用同一份数据。

## 项目结构

```
.
├── web/                 # 前端唯一源码（网页 + APK 共用）
│   ├── index.html
│   ├── css/style.css
│   ├── js/
│   │   ├── config.js
│   │   ├── storage.js
│   │   ├── app.js
│   │   └── env.example.js
│   └── fonts/
├── android/             # Android WebView 壳
├── scripts/
│   └── sync-web.sh
└── docs/
    ├── requirements.md      # 需求核对结论
    ├── architecture.md      # 云同步技术方案
    ├── setup.md             # Supabase / GitHub 初始化
    └── supabase-schema.sql  # 建表脚本
```

## 文档（云同步）

1. [需求纪要](docs/requirements.md)  
2. [技术方案](docs/architecture.md)  
3. [环境初始化](docs/setup.md)  
4. [建表 SQL](docs/supabase-schema.sql)  

## 功能概览

- 每日计划、运动打卡、读书笔记、心情日记
- 积分奖励与宠物换装
- 家长登录 + 家长操作密码
- 云端双向同步（须联网）；本地 JSON 备份/恢复作兜底
- 每日 19:00 系统提醒（仅 APK）

## 本地开发

### 网页版

```bash
cd web && python3 -m http.server 8080
```

浏览器访问 `http://localhost:8080`。

云同步开发前请按 [docs/setup.md](docs/setup.md) 配置 Supabase，并复制：

```bash
cp web/js/env.example.js web/js/env.js
# 编辑 env.js，填入 Project URL 与 anon key
```

### Android APK

要求：JDK 17+、Android SDK 35。

```bash
cd android
./gradlew :app:assembleDebug
```

构建前会自动将 `web/` 同步到 `app/src/main/assets/`。

## 数据说明

- **已实现**：家长账号注册/登录、`child_state` 云端读写、必须联网才能改、Realtime + 定时拉取
- 配置见 [docs/setup.md](docs/setup.md)；密钥放在 `web/js/env.js`（勿提交）
- 保留应用内「备份 / 恢复」JSON 作兜底
- 待做：多家长邀请、家长操作密码上云、多孩子 UI

## 许可证

私有项目，仅供家庭使用。
