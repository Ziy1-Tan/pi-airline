/**
 * pi-hud — Claude Code 风格的 pi 状态行。迁移自 claude-hud
 * (https://github.com/jarrodwatts/claude-hud)，颜色与之保持一致（硬编码 ANSI）。
 *
 * 在输入框下方显示两行状态（footer）：
 *   行1: [模型] │ 项目名 git:(branch*) │ ⏱ 时长（节流刷新，如 "5m"、"2h 30m"）
 *   行2: Context █████░░░░░ 45%
 *
 * 渲染做了 5s 节流：read/bash 等连续工具调用会合并渲染，不会每次调用都重绘。
 *
 * 安装：`pi install ./pi-hud` 或在 settings.json 的 extensions 里加绝对路径
 * 开关：/hud
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { basename } from "node:path";

// ── ANSI 颜色（与 claude-hud src/render/colors.ts 一致）──────────────────
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";

const colorize = (c: string, s: string) => `${c}${s}${RESET}`;
const cyan = (s: string) => colorize(CYAN, s);
const yellow = (s: string) => colorize(YELLOW, s);
const magenta = (s: string) => colorize(MAGENTA, s);
const dim = (s: string) => colorize(DIM, s);

// context 条颜色阈值（与 claude-hud getContextColor 一致）
function getContextColor(pct: number): string {
	if (pct >= 85) return RED; // critical
	if (pct >= 70) return YELLOW; // warning
	return GREEN;
}

function coloredBar(pct: number, width = 10): string {
	const safe = Math.min(100, Math.max(0, pct));
	const filled = Math.round((safe / 100) * width);
	const empty = width - filled;
	const color = getContextColor(safe);
	return `${color}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${RESET}`;
}

export default function (pi: ExtensionAPI) {
	// ── 状态 ──────────────────────────────────────────────
	let enabled = true;
	let sessionStart = Date.now();
	let lastElapsedAt = 0; // ⏱ 上次刷新时长的时间戳（节流）
	let cachedElapsed = ""; // ⏱ 当前缓存的时长文本
	let gitDirty: boolean | null = null;
	let gitCheckedAt = 0;
	let tuiRef: { requestRender(): void } | null = null;
	let footerInstalled = false;
	let renderTimer: ReturnType<typeof setTimeout> | null = null;
	let lastRenderAt = 0;
	const RENDER_INTERVAL = 5_000; // 渲染节流间隔（工具活动合并渲染）
	const ELAPSED_INTERVAL = 30_000; // ⏱ 时长刷新间隔（"3m 5s" 每 30s 才变一次）

	// ── 工具函数 ──────────────────────────────────────────
	// 时长格式与 claude-hud 原版 formatSessionDuration 一致：整分钟、不带秒
	const fmtDuration = (ms: number) => {
		const mins = Math.floor(ms / 60_000);
		if (mins < 1) return "<1m";
		if (mins < 60) return `${mins}m`;
		const hours = Math.floor(mins / 60);
		const rem = mins % 60;
		return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
	};

	// 节流渲染：两次渲染至少间隔 RENDER_INTERVAL，read/bash 等连续调用会被合并；
	// 末尾补一次尾部渲染，保证工具结束等最终状态一定能显示出来
	function requestRender() {
		const now = Date.now();
		const elapsed = now - lastRenderAt;
		if (elapsed >= RENDER_INTERVAL) {
			lastRenderAt = now;
			tuiRef?.requestRender();
		} else if (!renderTimer) {
			renderTimer = setTimeout(() => {
				renderTimer = null;
				lastRenderAt = Date.now();
				tuiRef?.requestRender();
			}, RENDER_INTERVAL - elapsed);
		}
	}

	function checkGitDirty(cwd: string) {
		if (Date.now() - gitCheckedAt < 10_000) return; // 节流：10s 内不重复跑
		gitCheckedAt = Date.now();
		execFile("git", ["status", "--porcelain"], { cwd }, (err, out) => {
			gitDirty = !err && out.trim().length > 0;
			requestRender();
		});
	}

	// ── footer ────────────────────────────────────────────
	function installFooter(ctx: ExtensionContext) {
		if (footerInstalled) return;
		footerInstalled = true;
		ctx.ui.setFooter((tui, _theme, footerData) => {
			tuiRef = tui;
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: () => {
					unsubBranch();
					footerInstalled = false;
					tuiRef = null;
				},
				invalidate() {},
				render(width: number): string[] {
					if (!enabled) return [];
					const lines: string[] = [];

					// ⏱ 时长（如 "5m"、"2h 30m"，不带秒）按 ELAPSED_INTERVAL 节流刷新，
					// 渲染再频繁也不会 1s 一跳
					const now = Date.now();
					if (now - lastElapsedAt >= ELAPSED_INTERVAL) {
						lastElapsedAt = now;
						cachedElapsed = fmtDuration(now - sessionStart);
					}
					const elapsed = cachedElapsed;

					// 行1: [模型] │ 项目 git:(branch*) │ ⏱ 5m  ← 与 claude-hud 同色
					const model = ctx.model?.name || ctx.model?.id || "no-model";
					const branch = footerData.getGitBranch();
					const proj = basename(ctx.cwd);
					const dirty = gitDirty === true ? "*" : "";
					const gitStr = branch
						? dim(" git:") + magenta(`(${branch}${dirty})`)
						: "";
					lines.push(
						truncateToWidth(
							cyan(`[${model}]`) +
								dim(" │ ") +
								yellow(proj) +
								gitStr +
								dim(` │ ⏱ ${elapsed}`),
							width,
						),
					);

					// 行2: Context █████░░░░░ 45%
					const usage = ctx.getContextUsage();
					if (usage) {
						const pct = usage.percent ?? 0;
						const bar = coloredBar(pct);
						const pctStr = colorize(getContextColor(pct), `${pct.toFixed(0)}%`);
						lines.push(
							truncateToWidth(dim("Context ") + bar + " " + pctStr, width),
						);
					}

					// 最底部垫两行空行，把 HUD 内容整体往上顶两行
					lines.push("", "");
					return lines;
				},
			};
		});
	}

	// ── 事件 ──────────────────────────────────────────────
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		sessionStart = Date.now();
		lastElapsedAt = 0;
		cachedElapsed = "";
		lastRenderAt = 0;
		installFooter(ctx);
		checkGitDirty(ctx.cwd);
	});

	pi.on("session_shutdown", async () => {
		tuiRef = null;
	});

	pi.on("model_select", async () => requestRender());

	pi.on("turn_start", async () => requestRender());

	pi.on("tool_execution_start", async () => requestRender());

	pi.on("tool_execution_end", async () => {
		checkGitDirty(process.cwd());
		requestRender();
	});

	// ── 命令 ──────────────────────────────────────────────
	pi.registerCommand("hud", {
		description: "Toggle pi-hud (status line footer)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(`pi-hud ${enabled ? "enabled" : "disabled"}`, "info");
			requestRender();
		},
	});
}
