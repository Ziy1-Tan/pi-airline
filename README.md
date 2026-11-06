# pi-airline

A Claude Code-style status line (statusline / HUD) for pi: model, project, git branch, session time and context usage, always in view.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![pi-airline in action](pi-airline-preview.png)

## Install

From a terminal, run:

```
pi install npm:pi-airline
```

Or straight from git:

```
pi install git:github.com/Ziy1-Tan/pi-airline
```

The HUD takes over the footer when the session starts, and `/hud` turns it off and back on. To update, run `pi update --extensions`, then `/reload` in a running session.

## Development

```bash
npm install
npm run typecheck
```

`extensions/pi-airline.ts` is the whole extension. There is no build step: pi loads the TypeScript directly.

## Credits

Layout and colors follow [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud).

## License

MIT. See [LICENSE](LICENSE).
