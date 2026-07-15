# 任务计划（task-pwa）

个人自用的离线优先任务管理 PWA。GitHub Pages 部署，IndexedDB/Dexie 本地数据，Dexie Cloud 免费版跨设备同步（MS2 起）。技术方案见项目文档（v4.2 执行版）。

## 原则（不可违背）

- **离线优先**：网络不是打开和编辑 App 的前提；本地 IndexedDB 先行渲染，同步只在后台。
- **零运行时 CDN**：所有资源随构建打包，由 Service Worker 预缓存；字体用系统字体栈。
- **本仓库不保存**：个人任务数据、Dexie Cloud 管理密钥、任何 Secret。

## 开发

```bash
npm install
npm run dev        # 开发（SW 不生效）
npm run build      # 构建（生成 SW 与 manifest）
npm run preview    # 本地验证构建产物（访问 /task-pwa/）
```

部署：推送到 `main` 后由 GitHub Actions 自动构建并发布到 Pages（`PAGES_BASE` 自动取仓库名）。

## 里程碑

MS0 离线 PWA 骨架（当前）→ MS1 本地任务 → MS2 Dexie Cloud 同步切片 → MS3 周期任务 → MS4 分类/已完成/今天 → MS5 月历 → MS6 购物清单 → MS7 桌面布局 → MS8 备份恢复 → MS9 动效与无障碍
