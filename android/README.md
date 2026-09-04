# Android 模块

库洛米打卡的 Android WebView 壳，适配 HUAWEI MatePad Air（HarmonyOS 4.2）。

前端资源来自仓库根目录的 [`web/`](../web/)，构建时由 Gradle 任务 `syncWebAssets` 自动复制到 `app/src/main/assets/`。

## 构建

```bash
./gradlew :app:assembleDebug
./gradlew :app:assembleRelease
```

## 原生能力

- 家长密码（SHA-256 加盐）
- 可信北京时间同步
- 每日 19:00 提醒通知
- 系统打印、分享、文件备份选择器

详细说明见 [根目录 README](../README.md)。
