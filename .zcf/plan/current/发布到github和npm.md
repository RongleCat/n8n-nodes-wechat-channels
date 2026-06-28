# 发布计划：n8n-nodes-wechat-channels v1.0.0

## 上下文

将 n8n 社区节点 `n8n-nodes-wechat-channels` 发布到 GitHub 和 npm，作为 n8n 可直接安装的社区节点。

## 用户确认信息

1. **GitHub 仓库**：`git@github.com:RongleCat/n8n-nodes-wechat-channels.git`（需新建）
2. **npm 认证**：OIDC Trusted Publishing（最省事，一次配置永久可用）
3. **首次版本**：`1.0.0`
4. **n8n Cloud**：接受仅自托管（节点使用 node:vm + WASM，不兼容 Cloud 沙箱）

## 执行步骤

### 阶段 A：代码准备
- [x] A1. 更新 `package.json` 版本 `0.1.0` → `1.0.0`
- [x] A2. 初始化 `CHANGELOG.md`（v1.0.0 初始发布）
- [x] A3. 初始化 git 仓库（`git init`）
- [x] A4. 首次提交所有文件（`git add + commit`）
- [x] A5. 创建并切换到 `main` 分支

### 阶段 B：GitHub 仓库
- [ ] B1. 用户在 GitHub 新建仓库 `RongleCat/n8n-nodes-wechat-channels`（不初始化）
- [ ] B2. 配置 remote 并推送（`git remote add origin ... && git push -u origin main`）
- [ ] B3. 验证 CI 通过

### 阶段 C：npm OIDC 配置
- [ ] C1. 用户在 npmjs.com 配置 Trusted Publisher
  - Repository owner: `RongleCat`
  - Repository name: `n8n-nodes-wechat-channels`
  - Workflow: `publish.yml`

### 阶段 D：发布执行
- [ ] D1. 本地执行 `npm run release`（lint → build → bump → tag → push）
- [ ] D2. GitHub Actions 自动发布到 npm（附带 provenance）

## 计划创建时间

2026-06-28 16:19:29
