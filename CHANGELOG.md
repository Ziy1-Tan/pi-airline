# Changelog

## [0.2.3]

- Fix: the elapsed-time clock renders as a full-size emoji (`⏱️`, with the emoji variation selector) instead of the small text glyph.

## [0.2.2]

- Change: when more than one provider is available, the model badge shows the provider, e.g. `[anthropic/Claude Sonnet 4]`. The prefix is dropped first if the line would not fit.

## [0.2.1]

- Change: the context bar width adapts to the terminal width, matching claude-hud: 10 cells at 100+ columns, 6 at 60-99, 4 below 60.

## [0.2.0]

- Fix: dirty marker refreshes every 10s even with no tool activity, so it no longer sticks after committing from another terminal.
- Fix: a failed or hung `git status` keeps the last snapshot instead of reporting the repo as clean; hung calls are killed after 10s.
- Fix: a git result still in flight across a session switch is dropped instead of showing the previous session's dirtiness.
- Fix: the context bar is hidden while usage is unknown (right after compaction) instead of showing a fake 0%.
- Change: (branch, dirty) always come from a single `git status -b --porcelain` snapshot; the framework's branch watcher now only triggers a re-sample.
- Change: elapsed time ticks every second while the session is idle.
- Change: renders are no longer throttled to 5s — the TUI already coalesces frames, so state changes show up immediately.
- Change: context usage is cached per (session, leaf, model); the footer no longer rescans the whole session on every keystroke.
- Change: when disabled or outside TUI mode, the extension spawns no processes and runs no timers.

## [0.1.0]

- Initial release: two-line footer HUD with model, project, git branch, session duration and context usage bar.
- `/hud` command to toggle the footer.
- Render throttle of 5s, with `git status` re-checked at most every 10s.
