/**
 * pi-airline — a Claude Code–style status line (HUD) for pi. Ported from claude-hud
 * (https://github.com/jarrodwatts/claude-hud), with matching colors (hardcoded ANSI).
 *
 * Replaces the footer with two lines:
 *   Line 1: [model] │ project git:(branch*) │ ⏱ elapsed (e.g. "5m", "2h 30m")
 *   Line 2: Context █████░░░░░ 45%
 *
 * Renders are throttled to one per 5s, so back-to-back tool calls (read/bash, ...)
 * are coalesced instead of repainting on every call.
 *
 * Install: `pi install git:github.com/Ziy1-Tan/pi-airline`
 * Toggle: /hud
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { basename } from "node:path";

// ── ANSI colors (claude-hud src/render/colors.ts palette) ───────────────
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";

const paint = (color: string, s: string) => `${color}${s}${RESET}`;

// Context bar: green <70%, yellow >=70%, red >=85%
const contextColor = (pct: number) => (pct >= 85 ? RED : pct >= 70 ? YELLOW : GREEN);

const BAR_WIDTH = 10;
const SEP = paint(DIM, " │ ");

// Whole minutes only, matching claude-hud's formatSessionDuration
function fmtDuration(ms: number): string {
	const mins = Math.floor(ms / 60_000);
	if (mins < 1) return "<1m";
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	const rem = mins % 60;
	return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export default function (pi: ExtensionAPI) {
	const RENDER_INTERVAL = 5_000; // render throttle (coalesces tool activity)
	const GIT_INTERVAL = 10_000; // don't re-run `git status` more often than this

	let enabled = true;
	let sessionStart = Date.now();
	let cwd = process.cwd();
	let gitDirty = false;
	let gitCheckedAt = 0;
	let tuiRef: { requestRender(): void } | null = null;
	let lastRenderAt = 0;
	let renderTimer: ReturnType<typeof setTimeout> | null = null;

	// Render at most once per RENDER_INTERVAL; a trailing render is scheduled so the
	// final state (e.g. after the last tool call of a turn) always shows up.
	function requestRender() {
		const wait = RENDER_INTERVAL - (Date.now() - lastRenderAt);
		if (wait <= 0) {
			lastRenderAt = Date.now();
			tuiRef?.requestRender();
		} else if (!renderTimer) {
			renderTimer = setTimeout(() => {
				renderTimer = null;
				lastRenderAt = Date.now();
				tuiRef?.requestRender();
			}, wait);
		}
	}

	function checkGitDirty() {
		if (Date.now() - gitCheckedAt < GIT_INTERVAL) return;
		gitCheckedAt = Date.now();
		execFile("git", ["status", "--porcelain"], { cwd }, (err, out) => {
			gitDirty = !err && out.trim().length > 0;
			requestRender();
		});
	}

	function installFooter(ctx: ExtensionContext) {
		ctx.ui.setFooter((tui, _theme, footerData) => {
			tuiRef = tui;
			const unsubBranch = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose: () => {
					unsubBranch();
					tuiRef = null;
				},
				invalidate() {},
				render(width: number): string[] {
					const model = ctx.model?.name || ctx.model?.id || "no-model";
					const branch = footerData.getGitBranch();

					const head = [paint(CYAN, `[${model}]`), paint(YELLOW, basename(cwd))];
					if (branch) {
						const dirty = gitDirty ? "*" : "";
						head.push(paint(DIM, "git:") + paint(MAGENTA, `(${branch}${dirty})`));
					}
					head.push(paint(DIM, `⏱ ${fmtDuration(Date.now() - sessionStart)}`));

					const lines = [truncateToWidth(head.join(SEP), width)];

					const usage = ctx.getContextUsage();
					if (usage) {
						const pct = Math.min(100, Math.max(0, usage.percent ?? 0));
						const color = contextColor(pct);
						const filled = Math.round((pct / 100) * BAR_WIDTH);
						const bar = paint(color, "█".repeat(filled)) + paint(DIM, "░".repeat(BAR_WIDTH - filled));
						const pctText = paint(color, `${Math.round(pct)}%`);
						lines.push(truncateToWidth(paint(DIM, "Context ") + bar + " " + pctText, width));
					}

					return lines;
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		sessionStart = Date.now();
		cwd = ctx.cwd;
		gitDirty = false;
		gitCheckedAt = 0;
		lastRenderAt = 0;
		checkGitDirty();
		if (enabled) installFooter(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (renderTimer) clearTimeout(renderTimer);
		renderTimer = null;
		tuiRef = null;
	});

	pi.on("model_select", async () => requestRender());

	pi.on("turn_start", async () => requestRender());

	pi.on("tool_execution_start", async () => requestRender());

	pi.on("tool_execution_end", async () => {
		checkGitDirty();
		requestRender();
	});

	pi.registerCommand("hud", {
		description: "Toggle the pi-airline footer (status line)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				installFooter(ctx);
			} else {
				ctx.ui.setFooter(undefined);
				tuiRef = null;
			}
			ctx.ui.notify(`pi-airline ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
