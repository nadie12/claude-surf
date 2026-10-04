# 🏄 claude-surf

**Surf while Claude thinks.** A [Claude Code](https://claude.com/claude-code) plugin that opens [surfd.net](https://surfd.net/) (classic CS-style surf in your browser) whenever Claude is working on a prompt, and pings you the second it's done.

```
you: "refactor the auth module"
claude: *thinking*            → browser tab opens, you hit surf_boreas
claude: *still thinking*      → status bar: "Claude is working — keep surfing · 2:14 · my-app"
claude: done                  → 🔔 ding + green banner "Claude is done — go check it"
```

## Install

In Claude Code:

```
/plugin marketplace add nadie12/claude-surf
/plugin install claude-surf@claude-surf
```

Restart Claude Code (or run `/hooks` to reload), then send any prompt. Requires Node.js 18+ on your `PATH` (you already have it if you installed Claude Code with npm).

## What it does

| Claude Code event | What happens |
| --- | --- |
| You submit a prompt | Local server starts (if needed). If Claude is still busy after 3s and no surf tab is open, one opens. |
| Claude uses tools | Heartbeat keeps the "working" timer alive. |
| Claude needs permission | Banner turns amber: **Claude needs you**, with a chime and desktop notification. |
| Claude finishes | Banner turns green: **Claude is done**, chime, flashing tab title, desktop notification. |

The page is just surfd.net in a full-screen iframe with a small status pill on top. Click the pill to dismiss the banner, or ⚙ for settings:

- **Sound** on/off
- **Open this tab automatically** on/off (saved to `~/.claude-surf.json`)
- **Desktop notifications** (click once to grant permission; recommended, since you'll be in pointer-lock)
- List of active Claude sessions (works across multiple terminals at once)

Quick prompts that finish within 3 seconds never open the tab.

## Commands

- `/claude-surf:surf` opens the surf tab right now.

## Config (environment variables)

| Variable | Default | |
| --- | --- | --- |
| `CLAUDE_SURF_PORT` | `7357` | Local port for the status server |
| `CLAUDE_SURF_DELAY_MS` | `3000` | How long Claude must be busy before the tab opens |
| `CLAUDE_SURF_DISABLE` | unset | Set to `1` to turn everything off |

## How it works

```
Claude Code hooks ──► scripts/hook.js ──HTTP──► scripts/server.js (127.0.0.1:7357)
                                                      │  Server-Sent Events
                                                      ▼
                                          public/index.html  (surfd.net iframe + status pill)
```

- `hook.js` runs on `UserPromptSubmit`, `PostToolUse`, `Stop`, `Notification` and `SessionEnd`. It starts the server if it isn't running, posts the session state, prints nothing, and always exits 0, so it can never block or change what Claude does.
- `server.js` has no dependencies. It listens on localhost only, tracks each session's state, opens your default browser when needed, and shuts itself down after an hour of inactivity.
- If you interrupt Claude with Esc (which fires no `Stop` hook), the session reads as idle on your next prompt, or after 30 minutes.

## Uninstall

```
/plugin uninstall claude-surf@claude-surf
```

## Credits

All the surfing is [surfd.net](https://surfd.net/). This plugin only embeds it and isn't affiliated with it. Go set a PB.

MIT licensed.
