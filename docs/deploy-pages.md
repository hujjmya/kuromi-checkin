# 部署到 GitHub Pages

仓库：https://github.com/hujjmya/kuromi-checkin  

线上地址：https://hujjmya.github.io/kuromi-checkin/

## 怎么工作的

- 源码在仓库的 `web/` 目录
- 推送到 `main` 后，GitHub Actions 自动把 `web/` 发布到 Pages
- 也可在 Actions 页手动 Run workflow：`Deploy web to GitHub Pages`

## 以后改代码怎么更新线上

1. 改本地 `web/` 里对应文件（如 `web/js/app.js`）
2. 提交并推送：

```bash
cd "/Users/admin/Desktop/SourceCode/打卡软件"
git add web/
git commit -m "更新说明"
git push
```

3. 等 1–2 分钟，刷新线上网址即可

也可在 GitHub 网页上直接编辑 `web/` 下的文件并 Commit。

## Supabase 必改

Authentication → URL Configuration：

- **Site URL**：`https://hujjmya.github.io/kuromi-checkin/`
- **Redirect URLs**：加上同一地址

## 说明

- 仓库已设为 **Public**（免费账号才能开 Pages）
- 打卡数据仍在 Supabase，需登录才能看
- `web/js/env.js` 里是 Publishable key，可放在前端；不要放 Secret key
