# Relay — a design for herdr-tsk-panel

> A task is not a card. It is a baton, and somebody is holding it right now.
> Relay makes that the thing you see.

Open `design/relay.html` in a browser. Click rows, press `j k ⏎ s d o t /`, hit `Night/Day`.
That file is the reference for every measurement below.

---

## 1. The problem with the current panel

The tsk panel answers "what is in my backlog" — a vertical list, sorted by project, with status
dots. It does not answer the three questions people actually ask during a working day:

1. **Who has the ball?** A review that pi finished an hour ago and a review I opened two minutes
   ago look identical.
2. **Where does this task live?** The panel knows a task is `started`; the tab strip knows a tab
   exists; nothing connects them.
3. **Who is busy, and with what?** The Agents block says `pi · working`. Working on *what*?

Relay's answer: every surface is organised around **custody** — the fact that at any instant a task
sits in exactly one actor's court (me, an agent, a person, or nobody), inside one space and one tab.
Custody is the join key between all five nouns, so it is what the UI draws.

---

## 2. The five nouns

| Noun | Today | In Relay |
|---|---|---|
| **Workspace** | a name in a sidebar | a *context* with a workload: how many tasks, how many wait on you, which actors are inside |
| **Tab** | a title | a *custody slot*: it carries the task it serves (`T31`), tinted by that task's stage |
| **Task** | a row with a status dot | a *baton* with a holder, an age, and a trace of who carried it |
| **Agent** | `pi · working` | an actor with a lane, an ink, a live dot, and the task in its court |
| **Person** | not shown at all | an actor like any other — `assignee_kind: person` already exists in tsk |

Everything colour-coded is an **actor** (● you, ◆ agent, ○ person) or a **stage**
(open · ready · started · blocked · review). Nothing else gets colour. Chrome stays achromatic.

---

## 3. The screen

```
┌──────────┬───────────────────────────────────────────────┬──────────────┐
│ Spaces 3 │ ingest T27 │ T31 tree T31 │ shell   Files Chg │              │ 38 titlebar
│  aurora 2│───────────────────────────────────────────────│              │
│  lumen  1│ T31   • You ▓▓░░░░░░░░░░░░░░░░░░░░░░ 1h18m    │ holds You 1.3h│ 64 RIBBON
│  handbook│ 3 mov ◆ pi ████████████████████ 1h45m ●         │              │
│          ├───────────────────────────────┬───────────────┴──────────────┤
│ Actors 4 │ Pi ~/aurora-api   T31·review  │ Relay  3 spaces · 2 on you   │
│ ● You T31│                               │ All 11 │ Wait on you 4 │ …  │
│ ◆ pi  T27│   # Decide: drop legacy path  │ ▍▍▍ T31  Decide: drop…  T31│ 1fr
│ ◆ codex  │   $ git diff --stat main      │ ├ verify 2/3                 │ STAGE
│ ○ Dana   │   app/ingest.py +38 −12       │ ├ plan 3/4                   │
│          │                               │ └ [Approve·1 left][Send back]│
│          │                               │   T29 ◎ Rotate the key  ⟳   │
│          │                               │ ● pi  T27 Ship rate limit   │
├──────────┴───────────────────────────────┴──────────────────────────────┤
│ 2 agents · 1 running        4 wait on you  j k move  ⏎ open  s start …  │ 26 status
└─────────────────────────────────────────────────────────────────────────┘
```

Row heights: titlebar 38 · tab strip 40 · **ribbon 64** · status 26. Left rail 232; relay panel 380
(from 330 — rows now carry a stage ladder, a holder glyph, a tab chip and an age).

Three regions carry the whole idea, and each is one glance wide:

- **ribbon** — custody of the *one* task you are looking at, across the day.
- **panel** — every live task, grouped by **who must act next**, not by project; or the **relay map**
  when you want the shape of the whole day.
- **status bar** — the attention meter: `4 wait on you`, then the keys that act on that number.

---

## 4. The ribbon (the signature)

A horizontal Gantt with one lane per actor who touched the task today. One bar per stretch of
custody; bar width = how long that actor held it. Not a log, not a timeline of clicks — a picture of
**who was responsible, and for how long**.

```
T31      • You     ▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  1h 18m   ← hatched: a person
 3 moves ◆ pi      ████████████████████████████████  1h 45m ●       ← solid: a machine
         14:20 started          16:06 submitted for review     holds You 1.3h
```

Details that matter:

- **Two textures.** Agent custody is a solid bar at 72% (the live one breathes 50↔32%). Human custody
  is a 45° hatch behind a 1px outline. At 11px tall on either theme the difference is instant — you
  never misread "the machine was on it" for "I was on it".
- **Durations inside the bar**, right-aligned, only when the bar is wide enough to hold them; the
  hollow bar gets a 1px plate under its number so the hatch doesn't eat it.
- **Handoffs** are a bead at the exact minute plus a 1px connector between lanes. The caption strip
  underneath (`16:06 submitted for review`) is collision-skipped — no label, no lie.
- **The right edge is now.** A hairline, a pulsing dot on the holder's lane, and a cap that reads
  `holds You 1.3h`. Age is the number people actually want; the panel sorts by it.
- **Axis** is derived, never fixed: from the earlier of (first move, now − 2h), rounded to the hour.
  Hour gridlines only — no tick labels competing with captions.
- **Degrades honestly.** One move → one bar. No moves → "Nobody has touched it yet — it is still in
  the inbox", not an empty grid. (See §9: tsk cannot always tell us who held it.)

Hovering a row ghosts the ribbon to that task at 50% — it is a **preview**, not a selection. In the
shipped mod this is the one interaction I would drop first (see §8, cross-block cost); clicking or
`j/k` gives the same information without a global re-render.

### 4b. The relay map — the same grammar at board zoom

The ribbon answers *this task*. The board-level question is *the shape of the day*: who was loaded,
when, and what is still open. The group switch cycles `by holder → by space → by stage → relay map`,
and the map is the ribbon scaled out:

- one row per live task, on a shared axis (earlier of first move, `now − 8h`, floored to `now − 45m`)
- the same two textures — solid bar = machine, hatch = person — so nothing has to be re-learned
- the current stretch breathes; a task nobody has touched is a dash at the left, not a lie
- click any bar to select; the ribbon above follows, the tab lights, the detail opens

Under it, **in court now**: one bar per actor, width = how many tasks are in their court, plus a
`nobody` row. That is the standup answer — `You 4 · codex 3 · pi 1 · Dana 1 · nobody 2` — and each
row is a filter: click `codex` and the map and list narrow to him.

Two zooms, one language: the map is what you open in the morning, the ribbon is what you look at
while deciding.

---

## 5. Interaction grammar

| Do | What happens |
|---|---|
`click` a row | select: ribbon follows, the tab it lives in lights, detail opens inline
`hover` a row | ribbon ghosts to that task (v1 prototype only)
`j` / `k` | move selection — the fastest way to walk the relay
`⏎` | open the task's tab (or start it, if it has none)
`s` | start / resume — runs the assigned agent in the task's space
`d` | done. **If the task owns a tab, ask first**: `T31 is done — close "T31 tree" with it?` `[Done + close] [Keep tab]`
`o` | open the tab without leaving the board
`t` | reply in the agent's tab (block answer / review feedback)
`/` | filter — matches number, title, thread, space
`click a bar in the map` | select that task (the ribbon is the zoom-in of the bar you clicked)
`click an actor's load row` | filter the board to that actor
`Esc` | close detail, then clear filter

Rules the design holds to:

- **No colour without meaning.** If a pixel is coloured it encodes an actor or a stage — or it is the
  attention meter. Two inks max per row.
- **No drag.** Herdr mods cannot drag internally (`on_drop` is external files only), so every
  relationship is expressed by click, key, or adjacency in the layout. Nothing in this design wants a
  drag.
- **Ask, never silently do.** The one destructive adjacency — closing a tab because the task is done —
  is a two-button inline row, not a dialog and not a `_asked` flag.
- **Disabled is a label, not a colour.** `Approve · 1 left` is dim and inert until the last check
  passes; hovering it says which check.
- **One detail open at a time**, inline under its row, so the list keeps its place.

---

## 6. Visual system

Direction: **instrument, not dashboard.** Hairline rules instead of cards, no shadows, 3px radii,
mono for anything that is an identifier or a time, tabular numbers everywhere.

| Role | Dark | Light |
|---|---|---|
| background | `#0d1012` | `#eceae3` |
| panel / rail | `#13171a` | `#f7f6f1` |
| raised / hover | `#1a2024` | `#ffffff` |
| rule | `#283136` | `#d7d3c6` |
| ink / muted / dim | `#e8ebe6` `#93a0a4` `#5e6b71` | `#191c1b` `#6a6f69` `#9a9e95` |
| **you** | foreground | foreground |
| **agent** | `#5fb3a4` | `#1e7a6e` |
| **person** | `#c08ad0` | `#7a4b86` |
| review / blocked / started / ready | `#d9a34a` `#e0705f` `#7fa8d0` `#9cbf6a` | `#8f6414` `#a83a2c` `#2f5f8a` `#55702a` |

Type: one family (`settings().ui_font_size` base; title +1, body +0.5, secondary −0.5, label −1) plus
the mono face for `T31`, `1h 18m`, `2/3`. Stage ladder in a row = five 3px ticks: past = dim rule,
current = stage ink, future = rule. The *only* rag in the list is the title column; everything else
is fixed-width so rows scan vertically.

---

## 7. Mapping to Herdr

Mods may only use theme tokens (`theme()`), never literals. The three actor inks have no direct
token, so they are derived, with a documented fallback chain:

| Our ink | Herdr token | Fallback |
|---|---|---|
| you | `foreground` | — |
| agent | `working` | `ansi6` (teal) |
| person | `unknown` | `ansi5` (magenta) |
| review | `accent` | — |
| blocked / started / ready / done | `blocked` / `working` / `done` / `dim` | — |

(That is close to what `main.js` already does for `STATUS_COLOR`; the addition is the two actor inks
and the rule that they never both appear in one row's chrome.)

### Layout delta — `layouts/herdr-work.json`

One new block in the work column, above `work-body`, and a wider panel:

```json
{"id": "work", "type": "column", "resizable": false, "children": [
  {"id": "tabs-row", "type": "row", "size": {"px": 42}, "resizable": false, "padding": [0, 8], "children": [
    {"id": "tabs", "type": "block", "size": {"weight": 1}, "window_drag": true, "content": {"mod": "tabs"}},
    {"id": "tsk-toggle", "type": "block", "content": {"mod": "tsk", "props": {"role": "toggle"}}, "size": {"px": 74}}
  ]},
  {"id": "relay-ribbon", "type": "block", "content": {"mod": "tsk", "props": {"role": "ribbon"}}, "size": {"px": 64}},
  {"id": "work-body", "type": "row", "padding": 8, "gap": 8, "children": [
    …unchanged main / panel…,
    {"id": "tsk-panel", "type": "column", "size": {"px": 380}, "min": 300, "max": 720, "children": [
      {"id": "tsk", "type": "block", "content": {"mod": "tsk"}}
    ]}
  ]},
  {"id": "status", "type": "block", "content": {"mod": "workspace-status"}, "size": {"px": 28}}
]}
```

The ribbon is a sibling block, not part of the panel, because it must span the terminal too — that
edge-to-edge strip is what makes it read as an instrument rather than a widget. No padding: it sits
flush under the tab strip like a ruler.

**Tab chips** are the one thing this design wants that Herdr owns. `{"mod":"tabs"}` is core code; a
mod cannot add a chip to it. The prototype therefore ships *both* strips behind a switch in the
titlebar (`tabs: relay ↔ herdr`) so the choice can be judged rather than argued:

| | Herdr's strip (today) | Relay's strip |
|---|---|---|
| shows | name, agent dot | name, holder glyph, `T<n>` chip, stage rail, "waits on you" notch |
| tab ↔ task link | none | the tab is tinted by the stage of the task it serves |
| owns | rename, settle, reorder, close, drag? | we re-implement all of it |
| cost | zero | a mod block that must be kept in step with core tab behaviour |

What the comparison shows: the link is worth ~4px of rail and one chip, and the strip is where a
person looks first. That is an argument for P4, not for shipping it blind — the panel and the pane
header (both ours) carry the same information today.

---

## 8. Mod architecture

Same split as today: `model.js` is pure and tested with `node --test tests/`, `main.js` is views.

New pure functions (each one a test):

| Function | Returns |
|---|---|
| `custodyOf(task, ledger)` | `[{actor, from, to, kind}]` — merged by actor, `to` = next handoff or `now` |
| `actorOf(id, actors)` | the actor record, or `{id, name: id, kind: "unknown"}` |
| `needsYou(t)` | `t.holder === "you" && (t.status === "review" \|\| t.status === "blocked")` |
| `holderOf(t)` | `review.on` / `block.on` / assignee / `"you"` / `null`, in that order |
| `groupBy(holder \| space \| stage)` | headers + rows + `oldest` age per group |
| `linkOf(t, tabs)` | the tab serving `t`, matched by `tsk=T<n>` label or `task` field |
| `haloArgs / askOf` | the inline "close the tab with it?" question and its two commands |

Views in `main.js`: `role: "ribbon"` (svg, ~90 lines), `role: "panel"` (today's panel, regrouped),
`role: "toggle"` (unchanged — it keeps the attention badge).

State that crosses blocks is one key, `shared("tsk.sel")` — set in click/key handlers only (never
during render, per AGENTS.md), read on every render. Hover preview is *not* shared: it would cost a
global re-render per mouse move.

**Data.** Two tiers, because they cost different things:

- `exec("tsk", ["list","--all","--json"])` — the lean feed (~12 fields), same as today, for rows.
- `readTextFile("$TSK_STATE_DIR/tsk.json")` — 413 KB locally, already home-readable, no process. It
  carries `history` (§9), `review.at`, `created_at`. Read it on selection + on a `watchFolder` event,
  not on every poll.

`watchFolder(~/.tsk)` replaces most of the 15 s polling: macOS watches recursively, so a `tsk status`
from anywhere in the app refreshes the board in one frame. Keep the timer as a slow fallback (30 s)
and for the rate chips (`5s/15s/1m/5m`) the panel already exposes.

---

## 9. What the data can and cannot tell us today

This is the honest part, and it decides how much of §4 can ship.

`tsk.json` keeps `history` per task — but the fields are thin:

```
{"kind":"created","at":[1790962614,128383000]}
{"kind":"status_set","at":[1790962621,590025000]}   ← no from, no to, no by
{"kind":"check_set","at":[…],"by":"you"}
{"kind":"replied","at":[…],"by":"you"}
{"kind":"step_checked","at":[…]}
```

and the lean `tsk list --json` feed exposes only `review.at` (a `[sec, nsec]` pair) and `closed_at`.

So: **when** something happened is recorded, **who** held the baton at that moment usually is not.
The current holder is always known (`review.on`, `block.on`, `assignee`, else you/nobody) — the
*history* of holders is not.

Three tiers, cheapest first:

1. **Ship now.** Lanes = actors we can prove: the current holder, plus the assignee, plus whoever
   `history[].by` names. Bars = current custody from `review.at`/`status_set.at` to now, with the
   recorded events as beads on the bar (each labelled by kind). No invented attribution. For a task
   that went to review an hour ago this is already the answer people want.
2. **Better over time, no dependency.** The mod appends what it observes: on each snapshot change,
   `{n, at, from, to}` into a ledger in `localStorage` (per mod copy, survives restart). Within a day
   every live task has a true trace; older ones stay at tier 1 rather than lying.
3. **Upstream, one line.** `status_set` gaining `{from, to, by}` in tsk's history makes tier 2
   unnecessary and the ribbon exact, retroactively, for everything recorded after the change. I would
   file that rather than build a permanent ledger — but not block the design on it.

Design rule that follows: **the ribbon never draws a lane it cannot justify.** A bar is either
observed, or derived from `review.at`/`status_set.at` with the caption saying so (`since review
opened`), or absent.

---

## 10. Phases

| Phase | Scope | Done when |
|---|---|---|
| **P0** ✅ | `model.js`: `holderOf`, `custodyOf` (tier 1 + ledger merge), `needsYou`, `groupBy`, `linksOf`/`linkOf`, `courtSince`/`ageOf`, `eventsOf`, `actorIdOf`/`actorOf`, and `normalize` keeping `assignee_kind`/`after`. 16 tests. | `node --test tests/` 47/47 green, no UI change yet |
| **P1** ✅ | `relay-ribbon` block (64px, between the tabs row and the body) + `traceOf`/`loadOf` in `model.js` + the panel publishing `shared("tsk.trace")`. The ribbon only reads. | Selecting a task redraws the instrument — verified in a real window: `T78 review · holds You · in court 53h 46m` with one hollow lane; board mode reads `15 live · You 2 · T73 1 · nobody 12` |
| **P2** ✅ | The list groups by `holder` / `stage` behind one cycling chip, each group carrying `oldest 2d`; a five-tick staircase per row instead of a status dot; a tab chip that walks to the task's space and tab; the project's name when the cards are gone; review checks listed one by one; `Done` reading `Approve` / `Approve · 2 left` on a review. | Verified in a real window: `You · oldest 2d · 2`, `T73`, `nobody · 12`, `review` / `open` groups, `T158` on one line, `Approve` on T78 |
| **P2b** ✅ | `relay map` as the fourth grouping: one row per live task, longest wait first, a 2px rule whose length is the wait and whose colour is the court, ages at the end, `in court now · oldest 5d · 15 live` above it; clicking a row traces it in the ribbon. The load block is the ribbon's board mode from P1. Needed `enrichTasks` — the list has no clocks, the store does. | Verified on the real store: 15 live, `oldest 5d`, `T45 5d` … `T88 11h`, `nobody` rows dimmer, `—` where nothing is provable |
| **P3** | Keys (`j k ⏎ s d o t /`), `shared("tsk.sel")`, `watchFolder`, rate chips re-pointed. | You can run a whole day without the mouse |
| **P4** *(optional)* | A mod-owned tab strip with task chips, replacing `{"mod":"tabs"}`. | Only if P1–P3 prove the strip is worth owning: rename/settle/reorder must be re-implemented and kept in step with Herdr |

Each phase leaves the app shippable, and P0/P1 alone are worth the repo.

Kept from today's panel, unchanged: the single `exec` per refresh, `attachTerminals` label matching,
`alertPlan`/`notify`, the capture footer (`new task → aurora-api`), the rate chips, board view,
`idOf`, and `tsk` as the only writer of task state.

---

## 11. Open questions

1. **Do we own the tab strip?** It is where "tab carries a task" lives. The prototype now has both
   strips behind a switch — look at them side by side. Owning it is P4 and costs a re-implementation
   of rename/settle/reorder; not owning it leaves the link in the pane header and the panel.
2. **Is the ledger acceptable?** Tier 2 writes state the CLI does not. It is local, append-only, and
   disposable — but it is still the mod remembering things.
3. **Panel width 380** — enough for `stage · T31 · title · tab · age`? At 330 the title column got
   squeezed to 22 characters in the prototype.
4. **How far back does the ribbon go?** The prototype starts at the earlier of (first move, now − 2h),
   which is honest for a tool people leave open all day but wrong for a task that has been in review
   since yesterday. Options: clamp to the last 8h and say `earlier …`, or make the axis zoomable.
