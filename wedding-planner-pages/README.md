# 婚礼工作台 GitHub Pages 版

这是从 `wedding-planner` Streamlit 项目整理出的静态前端版本，可以放到 GitHub Pages 上运行。页面代码只负责展示和调用 Supabase，真实数据存到 Supabase 表里。

## 目录

- `index.html`：页面入口
- `styles.css`：界面样式
- `app.js`：登录、关键日期、任务、收支逻辑
- `config.js`：Supabase 项目配置
- `supabase/schema.sql`：建表和 RLS 权限策略

## 本地预览

没有填写 Supabase 信息时，页面会进入本地预览模式，数据只保存在当前浏览器里，适合先看界面和流程。

```bash
python3 -m http.server 4173 -d wedding-planner-pages
```

然后打开：

```text
http://localhost:4173
```

## 接入 Supabase

1. 在 Supabase Dashboard 创建项目。
2. 打开 SQL Editor，执行 `supabase/schema.sql`。
3. 到 Project Settings -> API Keys，复制 Project URL 和 publishable/anon public key。
4. 填到 `config.js`：

```js
window.WORKBUDDY_CONFIG = {
  supabaseUrl: "https://你的项目.supabase.co",
  supabaseAnonKey: "你的 publishable 或 anon public key",
  allowedEmails: [
    "eathanma@gmail.com",
    "673112447@qq.com"
  ],
  engagementDate: "2026-08-22",
  weddingDate: "2027-06-01"
};
```

只能填 publishable key 或 anon public key。不要把 service_role、secret key、数据库密码放进前端代码。

## GitHub Pages

把 `wedding-planner-pages` 里的文件作为 Pages 根目录发布即可。发布前确认：

- `config.js` 已填 Supabase URL 和 public key
- `supabase/schema.sql` 已在 Supabase 执行过
- Supabase Auth 的 Site URL / Redirect URL 包含你的 GitHub Pages 地址

## 和旧版的区别

- 旧版是 Streamlit + 本地 JSON，不能直接部署到 GitHub Pages。
- 新版是纯 HTML/CSS/JS，可以直接静态托管。
- 新版是单页工作台，包含订婚倒计时、婚礼倒计时、可修改关键日期、任务看板和收支台账。
- 文件上传和文件桶已去掉。
- 旧版 JSON 里的真实财务数据没有复制进新版目录，避免之后误传到公开仓库。
