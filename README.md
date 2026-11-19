# 贾尼别科夫效应：真空 T 形刚体翻转与受力分析实验室

基于刚体欧拉动力学方程与 RK4 数值积分的真空 T 形金属旋转翻转（中间轴定理 / Dzhanibekov effect）3D 物理仿真与逐帧受力分析实验室。

**在线体验：** https://hana-ame.github.io/zhanibekov-effect/

纯前端实现（React + TypeScript + Three.js），无后端、无需 API Key，所有计算在浏览器内完成。

## 功能

- 真空无外力矩状态下 T 形刚体的自由旋转数值积分（欧拉方程 + RK4）
- 中间轴（不稳定轴）翻转现象的实时 3D 复现与轨迹拖尾
- 逐帧受力分析：离心力、陀螺力矩、欧拉力、角动量矢量
- 离心力双臂分解、角速度相空间、微观力分布等分析视图
- 初始角速度、时间倍率等参数可调

## 本地运行

```bash
bun install
bun run dev      # http://localhost:3000
bun run build    # 产物输出到 dist/
```

也兼容 npm（`npm install` / `npm run dev`）。

## 部署

部署完全由 GitHub Actions 完成，本地无需构建。

- 工作流：`.github/workflows/deploy.yml`（Build → Deploy）
- 触发：推送到 `main`，或在 Actions 页面手动 `Run workflow`
- Pages 发布源：**GitHub Actions**（不使用 `gh-pages` 分支）
- 依赖安装使用 Bun：`bun install --frozen-lockfile`，与仓库内 `bun.lock` 严格一致

更新只需推送：

```bash
git add -A && git commit -m "your change" && git push origin main
```

`vite.config.ts` 设置了 `base: './'`，因此构建产物可直接部署在 `/zhanibekov-effect/` 这样的子路径下。

## 结构

- `src/physics/dzhanibekov.ts` — 欧拉动力学方程与 RK4 积分核心（含测试）
- `src/components/VacuumScene3D.tsx` — Three.js 场景、刚体与矢量可视化
- `src/components/ForceAnalysisPanel.tsx` — 受力分析面板
- `src/components/BottomControlDock.tsx` — 播放、步进与参数控制
