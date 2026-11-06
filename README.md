# pi-hud

Claude Code 风格的 [pi](https://github.com/earendil-works/pi) 状态行（footer）。

```
[deepseek-flash] │ ob_notes git:(main*) │ ⏱ 12m
Context █████░░░░░ 45%
```

- 行1：当前模型 │ 项目目录 `git:(分支)`（有未提交改动时带 `*`）│ 会话时长
- 行2：context 占用条，绿色 <70%、黄色 ≥70%、红色 ≥85%

`⏱` 每 30 秒才刷新一次，渲染按 5 秒节流，连续工具调用不会导致状态行频繁重绘。配色沿用上游 claude-hud 的硬编码 ANSI。

## 安装

本地目录（本仓库）：

```bash
pi install ./pi-hud
```

或直接写进 `~/.pi/agent/settings.json`：

```json
{
  "extensions": ["/absolute/path/to/pi-hud"]
}
```

装好后 `/reload` 生效。用 `/hud` 开关显示。

## 开发

```bash
npm install
npm run typecheck
```

扩展只有一个文件 `extensions/pi-hud.ts`，无需构建，pi 直接加载 TypeScript。

## 致谢

逻辑与配色参考 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud)。

## License

MIT
