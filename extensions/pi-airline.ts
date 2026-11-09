/**
 * pi-airline — a Claude Code–style status line (HUD) for pi. Ported from claude-hud
 * (https://github.com/jarrodwatts/claude-hud), with matching colors (hardcoded ANSI).
 *
 * Replaces the footer with two lines:
 *   Line 1: [model] │ project git:(branch*) │ ⏱ elapsed (e.g. "5m", "2h 30m")
 *   Line 2: Context █████░░░░░ 45%
 *
 * Data model:
 * - (branch, dirty) always come from one `git status -b --porcelain` snapshot, so the
 *   pair is never sampled at two different times. The framework's branch watcher and a
 *   10s poll only trigger re-samples. A failed, hung, or stale git call keeps the last
 *   snapshot — "unknown" is never displayed as "clean".
 * - Elapsed runs on a 1s tick, so the clock moves even when nothing else repaints.
 * - Context usage is cached per (session, leaf, model): computing it scans the whole
 *   session, and the footer renders on every TUI frame (every keystroke).
 *
 * Install: `pi install npm:pi-airline`
 * Toggle: /hud
 */

import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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

const TICK_MS = 1_000; // elapsed-clock tick while idle
const GIT_POLL_MS = 10_000; // dirty freshness, even with no tool activity
const GIT_TIMEOUT_MS = 10_000; // kill hung `git status` (e.g. stuck network FS)

// Whole minutes only, matching claude-hud's formatSessionDuration
function fmtDuration(ms: number): string {
	const mins = Math.floor(ms / 60_000);
	if (mins < 1) return "<1m";
	if (mins < 60) return `${mins}m`;
	const hours = Math.floor(mins / 60);
	const rem = mins % 60;
	return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

// One `git status -b --porcelain` run: the displayed (branch, dirty) pair is atomic.
type GitSnapshot = { branch: string; dirty: boolean };

// "## main...origin/main [ahead 1]" → main; "## HEAD (no branch)" → detached;
// "## No commits yet on main" → main; any porcelain line below the header → dirty.
// Returns null for anything unexpected, so the caller keeps the previous snapshot.
function parseGitStatus(out: string): GitSnapshot | null {
	const lines = out.split("\n");
	const header = lines[0] ?? "";
	if (!header.startsWith("## ")) return null;
	let branch: string;
	if (header.startsWith("## No commits yet on ")) {
		branch = header.slice("## No commits yet on ".length).trim();
	} else {
		branch = header.slice(3).split(" ")[0].split("...")[0];
		if (branch === "HEAD") branch = "detached"; // "## HEAD (no branch)"
	}
	if (!branch) return null;
	const dirty = lines.slice(1).some((line) => line.length > 0);
	return { branch, dirty };
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let sessionStart = Date.now();
	let cwd = process.cwd();
	let git: GitSnapshot | null = null;
	let gitInFlight = false;
	let epoch = 0; // bumped on session boundaries; stale git callbacks are dropped
	let tuiRef: { requestRender(): void } | null = null;
	let usageCache: { key: string; value: ContextUsage | undefined } | null = null;

	// The TUI already coalesces frames (>=16ms apart), so no throttle is needed here.
	function requestRender() {
		tuiRef?.requestRender();
	}

	// Single-flight git poll. Results are tagged with the session epoch; a failed or
	// hung call keeps the last snapshot instead of reporting "clean".
	function pollGit() {
		if (!tuiRef || gitInFlight) return;
		gitInFlight = true;
		const my = epoch;
		execFile("git", ["status", "-b", "--porcelain"], { cwd, timeout: GIT_TIMEOUT_MS }, (err, out) => {
			if (my !== epoch) return; // session changed while git was running
			gitInFlight = false;
			if (!tuiRef || err) return;
			const snap = parseGitStatus(out);
			if (!snap) return;
			if (!git || git.branch !== snap.branch || git.dirty !== snap.dirty) {
				git = snap;
				requestRender();
			}
		});
	}

	// getContextUsage() scans the whole session, and the footer renders on every TUI
	// frame (every keystroke). Cache per (session, leaf, model) — all O(1) reads —
	// using the same invalidation the built-in footer relies on: entries are
	// append-only and every append moves the leaf.
	function getUsage(ctx: ExtensionContext): ContextUsage | undefined {
		const sm = ctx.sessionManager;
		const key = `${sm.getSessionId()}|${sm.getLeafId()}|${ctx.model?.id ?? ""}`;
		if (usageCache && usageCache.key === key) return usageCache.value;
		const value = ctx.getContextUsage();
		usageCache = { key, value };
		return value;
	}

	function installFooter(ctx: ExtensionContext) {
		ctx.ui.setFooter((tui, _theme, footerData) => {
			tuiRef = tui;
			// The watcher only triggers a re-sample; display always comes from `git`.
			const unsubBranch = footerData.onBranchChange(() => pollGit());
			// Keep the clock live while idle, and dirty fresh without tool activity.
			const tick = setInterval(() => requestRender(), TICK_MS);
			const poll = setInterval(() => pollGit(), GIT_POLL_MS);
			pollGit();
			return {
				dispose: () => {
					unsubBranch();
					clearInterval(tick);
					clearInterval(poll);
					tuiRef = null;
				},
				invalidate() {},
				render(width: number): string[] {
					const model = ctx.model?.name || ctx.model?.id || "no-model";
					const head = [paint(CYAN, `[${model}]`), paint(YELLOW, basename(cwd))];
					if (git) {
						head.push(paint(DIM, "git:") + paint(MAGENTA, `(${git.branch}${git.dirty ? "*" : ""})`));
					}
					head.push(paint(DIM, `⏱ ${fmtDuration(Date.now() - sessionStart)}`));

					const lines = [truncateToWidth(head.join(SEP), width)];

					// percent is null right after compaction, until the next LLM
					// response — unknown stays hidden instead of rendering 0%.
					const usage = getUsage(ctx);
					if (usage && usage.percent != null) {
						const pct = Math.min(100, Math.max(0, usage.percent));
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
		epoch++; // drop git results still in flight from the previous session
		git = null;
		gitInFlight = false;
		usageCache = null;
		if (enabled) installFooter(ctx); // the component owns the timers and first poll
	});

	// The framework disposes the footer on teardown (clearing the timers); bumping
	// the epoch also drops any git callback still in flight.
	pi.on("session_shutdown", async () => {
		epoch++;
	});

	pi.on("model_select", async () => requestRender());
	pi.on("turn_start", async () => requestRender());
	pi.on("tool_execution_start", async () => requestRender());

	pi.on("tool_execution_end", async () => {
		pollGit();
		requestRender();
	});

	pi.registerCommand("hud", {
		description: "Toggle the pi-airline footer (status line)",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				installFooter(ctx);
			} else {
				ctx.ui.setFooter(undefined); // dispose clears timers + subscription
			}
			ctx.ui.notify(`pi-airline ${enabled ? "enabled" : "disabled"}`, "info");
		},
	});
}
