# stealth-reader

`stealth-reader` 是一个基于 Tauri 2、Vite 和 TypeScript 的轻量桌面阅读/悬浮窗应用。

## 项目结构

- `src/`：前端页面与交互代码。
- `src-tauri/`：Tauri 桌面壳、权限和原生配置。
- `index.html`：Vite 入口页面。
- `vite.config.ts`：前端构建配置。
- `tsconfig.json`：TypeScript 配置。

## 常用命令

```bash
npm install
npm run dev
npm run build
npm run tauri
```

## 说明

窗口配置位于 `src-tauri/tauri.conf.json`，当前应用名为 `Stealth Reader`，默认小窗口、无系统装饰、置顶显示。
