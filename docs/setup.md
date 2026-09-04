# Supabase 与 GitHub 初始化

按下列步骤准备云端环境。完成后即可开始改前端接登录与同步。

## 一、创建 Supabase 项目

1. 打开 [https://supabase.com](https://supabase.com) 注册/登录  
2. **New project** → 选 Free → 记下地区（靠近用户即可）  
3. 设置数据库密码并妥善保存  

## 二、关闭邮箱确认（必须）

本项目用「账号密码」登录，**不要发验证邮件**：

1. 进入项目 → **Authentication** → **Providers** → **Email**  
2. 关闭 **Confirm email**（有的界面叫 Confirm email / Enable email confirmations）  
3. 保存  

可选：在 Email 模板里保持默认即可，因为不会走到确认流程。

## 三、执行建表 SQL

1. 打开 **SQL Editor** → New query  
2. 粘贴仓库中的 [`supabase-schema.sql`](./supabase-schema.sql) 全文  
3. **Run**，确认无报错  

## 四、开启 Realtime（建议，家长端可少刷新）

1. **Database** → **Publications**（或 Replication）  
2. 将 `child_state` 加入 `supabase_realtime`  
3. 或在 SQL Editor 执行（若 publication 已存在）：

```sql
alter publication supabase_realtime add table public.child_state;
```

## 五、拿到前端密钥

1. **Project Settings** → **API**  
2. 复制：  
   - **Project URL**  
   - **anon public** key  

这两项会写进前端配置（仅 anon key，**不要**把 `service_role` 放进 App/网页）。

在本地配置密钥：

```bash
cp web/js/env.example.js web/js/env.js
# 编辑 env.js，填入 Project URL 与 anon public key
```

`web/js/env.js` 已加入 `.gitignore`，不要提交真实密钥。  
网页与 APK 都依赖该文件；打包 APK 前请先填好再执行 `./scripts/sync-web.sh`。

## 六、账号映射约定

用户界面只显示「账号」「密码」。

| 界面 | 传给 Supabase Auth |
|------|-------------------|
| 账号 `parent01` | email = `parent01@kuromi.local` |
| 密码 | password |

前端负责拼接/拆解 `@kuromi.local`，用户无感知。

账号校验建议：`/^[a-zA-Z0-9_]{3,32}$/`。

## 七、GitHub 仓库与 Pages（实现阶段再做细配）

1. 在 GitHub 新建私有或公开仓库  
2. 推送本项目根目录  
3. **Settings → Pages**：Source 选 `web/` 所在分支与目录（或用 GitHub Actions 发布 `web/`）  

登录后的网页必须走 HTTPS，以便调用 Supabase。

## 八、自检清单

- [ ] Confirm email 已关闭  
- [ ] `supabase-schema.sql` 执行成功  
- [ ] 能在 Table Editor 看到 `families`、`children`、`child_state` 等表  
- [ ] 已复制 Project URL 与 anon key  
- [ ] （可选）`child_state` 已开 Realtime  

## 九、安全提示

- Free 项目约 7 天无访问可能暂停，每天打卡一般无影响  
- 不要把 `service_role` key 提交到 Git  
- 家长操作密码只存哈希（见 `parent_pins`），与登录密码分离  

更完整的设计说明见 [architecture.md](./architecture.md)。
