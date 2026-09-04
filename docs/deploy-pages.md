# 部署到 GitHub Pages

## 一次部署（推荐）

1. 在 GitHub 新建仓库（可私有），例如 `kuromi-checkin`
2. 本机推送：

```bash
cd "/Users/admin/Desktop/SourceCode/打卡软件"
git remote add origin https://github.com/你的用户名/kuromi-checkin.git
git push -u origin main
```

3. 打开仓库 → **Settings → Pages**
   - Source：**Deploy from a branch**
   - Branch：`main`
   - Folder：**`/web`**
   - Save

4. 几分钟后访问：

`https://你的用户名.github.io/kuromi-checkin/`

5. 在 Supabase → **Authentication → URL Configuration**：
   - **Site URL** 填上面的 Pages 地址
   - **Redirect URLs** 加上同一地址（可加 `/**`）

## 以后改文件怎么更新

只改网页时，替换 `web/` 里对应文件即可，例如：

- `web/js/app.js`
- `web/js/cloud.js`
- `web/css/style.css`
- `web/index.html`

然后：

```bash
cd "/Users/admin/Desktop/SourceCode/打卡软件"
git add web/
git commit -m "更新网页"
git push
```

几分钟后 Pages 会自动更新。也可在 GitHub 网页上直接编辑/上传文件。

## 注意

- `web/js/env.js` 已包含 Publishable key，Pages 才能登录；不要把 **Secret key** 放进仓库
- 平板 APK 不走 Pages，仍需本地/Android 打包；打包前执行 `./scripts/sync-web.sh`
