# Handball

Unified Handball Club Management App for the Utah Handball Association.

Phase 1 merge of two PWAs into one tabbed app:
- **Rankings** — ELO leaderboard, match reporting with admin approval, head-to-head, match history
  (ported from `Utah-Handball`)
- **Tournaments** — tournament setup, seeded brackets (single/double elim, round robin),
  live bracket view, archiving (ported from `UHA-Tournaments`)

Both halves share one Firebase project (`utah-handball`) — the player database and the
match-approval queue were already shared before the merge.

## Layout

- `index.html` — app shell: tab bar + the two views + shared admin login modal
- `css/app.css` — one stylesheet; each view's rules are scoped under its section
- `js/core.js` — Firebase init, shared `db`, `isAdmin` + auth state, view switching
- `js/rankings.js` / `js/tournaments.js` — the two halves, ported with minimal changes
- `sw.js` — service worker (static assets cached, Firebase realtime stays on network)

Vanilla JS only — no frameworks, no build step.
