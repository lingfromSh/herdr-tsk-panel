// tsk beside your agents: every tsk project's progress at a glance — what waits on your review,
// what is blocked, what is moving — with the current space's project first, and one keystroke to
// start a task, finish it, archive it, or open tsk's own board in a tab. An agent Start runs keeps
// its terminal address in `hc`'s labels, so the panel shows whether it is still working and walks
// you back to it. A task that changes status while you are elsewhere raises a notification.
//
// Roles (props.role): the panel (default), and "toggle", the tab-bar button that shows or hides
// the layout's "tsk-panel" node. The toggle reads the shared attention count the panel writes, so
// the tab bar shows how many tasks wait on you even while the panel is hidden.
import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import {
  exec, run, hc, spaces, focused, home, knownAgents, shared, setShared, theme, settings, layout,
  terminals, notify, playSound, readTextFile, props as blockProps,
} from "herdr";
import {
  STATUSES, LABEL, LIST, PATHS, parseList, lastLine, buildProjects, totalsOf, filterTasks,
  filterProjects, idOf, addArgs, statusArgs, archiveArgs, boardOf, taskHint, pickAgent, launchArgs, agentBrief, hcError,
  agentName, whereLabel, whoLine, tabMates,
  snapshotOf, changedTasks, alertPlan, INTERVALS, parsePoll, hcRunArgs, taskTerminal, isLive,
  traceOf, loadOf, mapOf, enrichTasks, actorIdOf, linksOf, linkOf, groupBy, stageOf, reviewLeft,
} from "./model.js";

const PANEL = "tsk-panel"; // the layout node the toggle shows and hides; hidden state is the layout's, so it survives space switches
const ATTENTION = "tsk.attention"; // shared: tasks in review or blocked, for the tab-bar badge
const TRACE = "tsk.trace"; // shared: what the ribbon draws — a task's custody stretches, or the board's load
const SEL = "tsk.sel"; // shared: the task number the ribbon is tracing
const DESK = "·desk"; // the expanded-set key for tasks that belong to no project
const POLL_KEY = "tsk.poll"; // localStorage: the interval this panel last used
const BY_KEY = "tsk.by"; // localStorage: how the list groups — by project, by court, by stage
const BY = ["project", "court", "stage", "map"];

const NOTICE_MS = 5000;

// ---- Running tsk ----

// Herdr's exec has a 30s limit and the usual PATH may miss ~/.local/bin.
const sh = (script, args = []) => exec("sh", ["-c", `${PATHS}\n${script}`, "tsk-panel", ...args], { timeout: 20000 })
  .catch((e) => ({ code: 127, stdout: "", stderr: String((e && e.message) || e) }));
const tsk = (args) => sh('exec tsk "$@"', args);

// Work started from render. cx.spawn runs its body up to the first await at once, and
// cx.notify() throws while a view renders, so the work starts after the render ends.
const later = (cx, fn) => cx.spawn(async (cx) => { await cx.sleep(0); return fn(cx); });

const activeSpace = () => spaces().find((s) => s.active) || null;

function S() {
  const b = Number(settings().ui_font_size) || 13;
  return { title: b + 1, body: b + 0.5, secondary: b - 0.5, button: b - 0.5, label: b - 1 };
}

// ---- Look (Herdr theme tokens only) ----

const icon = (name, size, color) => svg(`mods/tsk/icons/${name}.svg`).size(size).flex_none().text_color(color);

// The agent's own icon from Herdr's program table (π for pi), falling back to a terminal glyph.
const programIcon = (term, size, color) => {
  const p = term && term.program;
  if (!p || !p.icon) return icon("terminal", size, color);
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
};
const stop = (_e, cx) => cx.stop_propagation();
const dot = (color, size = 8) => div().w(size).h(size).flex_none().rounded_full().bg(color);

const STATUS_COLOR = (t, status) => ({
  review: t.accent, blocked: t.blocked, started: t.working, ready: t.done, open: t.muted, done: t.dim,
}[status] || t.muted);

// Colour encodes the actor, never the chrome: a person and a machine must not look alike.
const ACTOR_INK = (t, kind) => ({
  you: t.foreground, agent: t.working, person: t.unknown, task: t.muted, other: t.dim,
}[kind] || t.muted);

/** 95 minutes → "1h 35m"; under an hour, "42m". */
function dur(ms) {
  const m = Math.max(0, Math.round(Number(ms) / 60000));
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
const clock = (ms) => {
  const d = new Date(ms), h = d.getHours(), m = d.getMinutes();
  return `${h < 10 ? "0" : ""}${h}:${m < 10 ? "0" : ""}${m}`;
};
/** Minutes → `12m`, `3.4h`, `2d`: how long something has been waiting. */
const ageLabel = (m) => {
  const v = Math.max(0, Math.round(Number(m) || 0));
  if (v < 60) return `${v}m`;
  if (v < 1440) return `${(v / 60).toFixed(v < 600 ? 1 : 0)}h`;
  return `${Math.round(v / 1440)}d`;
};

/**
 * Five ticks, not a dot: a dot says what a task is, the rail says how far it walked.
 * `blocked` is not a stage of its own — it parks on `started`, in the blocked colour.
 */
function rail(t, task) {
  const at = stageOf(task);
  const ink = STATUS_COLOR(t, task.status);
  // A staircase, not a row of dots: the tallest tick is how far the task walked, and only the
  // stage it stands on carries the status colour, so a 2px-wide tick still reads at 380px.
  const steps = [3, 5, 7, 9, 11];
  return h_flex().w(23).flex_none().gap(2).items_end().h(11)
    .children(steps.map((h, i) => div().flex_1().h(h).rounded(1)
      .bg(i === at ? ink : (i < at ? t.dim : t.border)).opacity(i === at ? 1 : (i < at ? 0.75 : 0.9))));
}

/** `/Users/me/work/api` → `api`: the ribbon has 112px, not a path. */
const projectName = (path) => String(path || "").replace(/\/+$/, "").split("/").pop() || "";

function primary(id, label, t, onClick, opts = {}) {
  const h = opts.h || 26;
  return h_flex().id(id).h(h).px(opts.px || 10).gap(5).flex_none().items_center().rounded(6).bg(t.solid)
    .text_size(opts.size || S().button).font_semibold().text_color(t.solid_foreground).cursor_pointer()
    .hover((s) => s.opacity(0.88)).on_mouse_down("left", stop).on_click(onClick)
    .when(Boolean(opts.icon), (el) => el.child(icon(opts.icon, 12, t.solid_foreground))).child(label);
}

function secondary(id, label, t, onClick, opts = {}) {
  const c = opts.color || t.foreground, h = opts.h || 26;
  return h_flex().id(id).h(h).px(opts.px || 10).gap(5).flex_none().items_center().rounded(6)
    .when(!opts.quiet, (el) => el.border_1().border_color(t.border))
    .text_size(opts.size || S().button).text_color(c).cursor_pointer().hover((s) => s.bg(t.hover))
    .on_mouse_down("left", stop).on_click(onClick)
    .when(Boolean(opts.icon), (el) => el.child(icon(opts.icon, 12, c))).child(label);
}

const pill = (text, t, c) => h_flex().h(19).px(7).flex_none().items_center().rounded(10).bg(t.selected)
  .text_size(S().label).text_color(c || t.muted).child(text);

const note = (t, text) => div().text_size(S().secondary).text_color(t.muted).child(text);

function warnBox(t, text) {
  return h_flex().mx(10).mt(6).p(8).gap(7).items_start().rounded(6).bg(t.chrome).border_1().border_color(t.ansi1)
    .child(icon("alert", 13, t.ansi1)).child(div().flex_1().text_size(S().secondary).text_color(t.muted).child(text));
}

/** A project's shape in one strip: done as a hole, each status a colour, at most 96px wide. */
function bar(t, project, width = 80) {
  const c = project.counts, parts = STATUSES.filter((s) => c[s] > 0);
  const base = div().w(width).h(4).flex_none().rounded(2).overflow_hidden().bg(t.border);
  if (!project.total) return base;
  return h_flex().w(width).h(4).flex_none().rounded(2).overflow_hidden().bg(t.border)
    .when(project.done > 0, (el) => el.child(div().h_full().flex_grow(project.done).bg(t.done).opacity(0.5)))
    .children(parts.map((s) => div().h_full().flex_grow(c[s]).bg(STATUS_COLOR(t, s))));
}

function find(node, id) {
  if (node && node.id === id) return node;
  for (const child of (node && node.children) || []) { const f = find(child, id); if (f) return f; }
  return null;
}

// ---- The tab-bar button ----

function toggle() {
  const t = theme(), node = find(layout(), PANEL), on = node && !node.hidden;
  const waiting = Number(shared(ATTENTION)) || 0;
  return h_flex().size_full().pr(10).items_center().bg(t.chrome).border_b(1).border_color(t.border)
    .child(h_flex().id("toggle-tsk").h(26).px(8).gap(5).flex_none().items_center().rounded(6)
      .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click(() => run("layout.toggle", { id: PANEL }))
      .child(image("mods/tsk/mark.svg").w(15).h(15).flex_none())
      .child("tsk")
      .when(waiting > 0, (el) => el.child(pill(String(waiting), t, t.accent))));
}

// ---- The panel ----

export default class Tsk extends View {
  init(_props, cx) {
    const given = blockProps() || {};
    this.role = given.role || "panel";
    if (this.role === "ribbon") {
      // The ribbon owns no data: it draws the trace the panel publishes and re-renders when that
      // value changes, plus a slow tick so the right edge of the axis walks forward between polls.
      this.width = 0; // the plot's measured width, in logical px
      cx.spawn(async (cx) => {
        for (;;) { await cx.sleep(20000); cx.notify(); }
      });
      return;
    }
    if (this.role === "toggle") return;

    this.handle = cx.focus_handle();
    this.projects = [];
    this.done = 0;
    this.error = null;
    this.loadedAt = 0;
    this.loading = false;
    this.token = 0; // execs from before an action are stale: their token no longer matches
    this.agents = null; // knownAgents() once: the coding agents Start may run
    this.expanded = new Set();
    this.openTask = null;
    try { this.by = BY.indexOf(localStorage.getItem(BY_KEY)) >= 0 ? localStorage.getItem(BY_KEY) : "project"; } catch (_e) { this.by = "project"; }
    this.links = []; // `tsk=T<n>` terminals and task-named tabs, per refetch: which tab a task lives in
    this.sel = null; // the task number the ribbon traces: set by a click, cleared when it is gone
    this.confirm = null; // the row asking whether Done should close the agent's tab
    this.notice = null;
    this.noticeAt = 0;
    this.query = "";
    this.wasHidden = false;
    this.refreshed = false;
    this.seen = null; // id → status of the last refetch: the baseline a notice is a change against
    this.alertOn = given.notify !== false; // props.notify: false keeps the panel quiet
    this.sound = given.sound ? String(given.sound) : null; // props.sound: a macOS sound name

    this.terminals = []; // Herdr's live core terminals: an agent Start ran is found here by its label

    let stored = null;
    try { stored = localStorage.getItem(POLL_KEY); } catch (_e) { stored = null; }
    this.poll = parsePoll(stored !== null ? stored : given.poll); // props.poll as the default
    this.lastPoll = 0;

    this.filter = InputState.new({ placeholder: "Filter tasks" });
    this.filter.on("change", (_e, cx) => { this.query = this.filter.value(); cx.notify(); });
    this.capture = InputState.new({ placeholder: "New task — Enter adds it" });
    this.capture.on("submit", (_e, cx) => this.addTask(cx));

    // Refetching: the strip's chips set how often, and "off" leaves only the refresh button, a
    // refetch when the column comes back, and the one after a write.
    cx.spawn(async (cx) => {
      for (;;) {
        await cx.sleep(1000);
        if (!this.poll || this.loading) continue;
        if (Date.now() - this.lastPoll < this.poll) continue;
        this.refresh(cx);
      }
    });
  }

  // ---- Data ----

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    this.lastPoll = Date.now();
    const token = ++this.token;
    cx.spawn(async (cx) => {
      const r = await sh(LIST);
      if (token !== this.token) return;
      this.loading = false;
      if (r.code === 127) {
        this.error = "tsk is not on PATH — install it with `curl -fsSL https://gettsk.sh/install.sh | sh`";
      } else if (r.code !== 0) {
        this.error = lastLine(r.stderr) || `tsk list exited ${r.code}`;
      } else {
        const parsed = parseList(r.stdout);
        this.error = parsed.error;
        // The list feed has no `history` and no `created_at`; the store does, and a wait cannot be
        // dated without them. One read, merged by task number, never fatal.
        const store = await this.readStore();
        const live = enrichTasks(parsed.live, store), done = enrichTasks(parsed.done, store);
        this.projects = buildProjects(live, done, this.openFolders());
        this.done = parsed.done.length;
        this.attachTerminals();
        this.loadedAt = Date.now();
        this.refreshed = true;
        this.alertsFor(live.concat(done));
        if (!this.expanded.size) {
          // First look: unfold whatever the open spaces are working in.
          for (const p of this.projects) if (p.active) this.expanded.add(this.keyOf(p));
        }
        setShared(ATTENTION, totalsOf(this.projects).attention);
        this.publish();
      }
      cx.notify();
    });
  }

  /** tsk's own store, for the fields the CLI leaves out. Missing or unreadable is not an error. */
  async readStore() {
    try {
      const text = await readTextFile(`${home()}/.tsk/tsk.json`);
      return text ? JSON.parse(text) : null;
    } catch (_e) {
      return null;
    }
  }

  /**
   * Each task's agent terminal, out of Herdr's live core list: the label `hc run` was given, or
   * the task's name. Live data, so this costs no second poll and needs no state file.
   */
  attachTerminals() {
    let rows = [];
    try { rows = terminals() || []; } catch (_e) { rows = []; }
    this.terminals = rows;
    for (const p of this.projects) for (const task of p.tasks) task.term = taskTerminal(task, rows);
    let open = [];
    try { open = spaces() || []; } catch (_e) { open = []; }
    this.links = linksOf(rows, open);
  }

  /** Folders the open spaces sit in: a project holding one is the current one. */
  openFolders() {
    const folders = spaces().map((s) => s.folder).filter(Boolean);
    const f = focused();
    if (f && f.cwd) folders.push(f.cwd);
    return folders;
  }

  /**
   * One notification per status move since the last refetch. Done tasks arrive in the done list,
   * not as a status change in the live one, so both lists are the baseline.
   */
  alertsFor(tasks) {
    const seen = this.seen;
    this.seen = snapshotOf(tasks);
    if (!seen || !this.alertOn) return;
    for (const a of alertPlan(changedTasks(seen, tasks))) {
      notify({ title: a.title, body: a.body, level: a.level });
    }
    if (this.sound) playSound(this.sound);
  }

  /** A move the panel made itself is not news: record it so the next poll sees no change. */
  expect(task, status) {
    if (this.seen) this.seen[task.id] = status;
  }

  keyOf(project) { return project.desk ? DESK : project.path; }

  /** Element ids carry project paths and task ids: keep them to what an id may hold. */
  idOf(key) { return idOf(key); }

  say(kind, text, cx) {
    this.notice = { kind, text };
    const at = ++this.noticeAt;
    later(cx, async (cx) => {
      await cx.sleep(NOTICE_MS);
      if (this.noticeAt !== at) return; // a newer notice owns the line
      this.notice = null;
      cx.notify();
    });
  }

  /** Where a new task lands: the current space's project, else the desk. */
  captureTarget() {
    const active = this.projects.find((p) => p.active);
    return active || null;
  }

  addTask(cx) {
    const title = this.capture.value().trim();
    if (!title) return;
    const target = this.captureTarget();
    this.capture.set_value("");
    cx.spawn(async (cx) => {
      const r = await tsk(addArgs(title, target && !target.desk ? target.path : null));
      const added = r.code === 0 ? firstNumber(r.stdout) : 0;
      this.say(r.code === 0 ? "ok" : "warn",
        r.code === 0 ? `Added ${added ? `T${added}` : "a task"}${target ? ` to ${target.name}` : " to the desk"}`
          : lastLine(r.stderr) || `tsk add exited ${r.code}`, cx);
      cx.notify();
      this.refresh(cx);
    });
  }

  /**
   * Archive: the panel's "remove". tsk's command line has no delete, so this takes the task off
   * every working view and keeps its number and status; `tsk unarchive T<n>` brings it back.
   */
  archive(task, cx) {
    cx.spawn(async (cx) => {
      const r = await tsk(archiveArgs(task.number));
      this.say(r.code === 0 ? "ok" : "warn",
        r.code === 0 ? `T${task.number} archived · tsk unarchive T${task.number} brings it back`
          : lastLine(r.stderr) || `tsk archive exited ${r.code}`, cx);
      cx.notify();
      this.refresh(cx);
    });
  }

  /** The agent Start runs: props.run (an argv, e.g. ["pi"]), else props.agent by key or name, else the most picked installed one. */
  async agentNow() {
    const p = blockProps() || {};
    if (Array.isArray(p.run) && p.run.length > 0) {
      return { key: String(p.run[0]), name: String(p.run[0]), run: p.run };
    }
    if (!this.agents) this.agents = await knownAgents().catch(() => []);
    return pickAgent(this.agents, p.agent);
  }

  /**
   * Start: tsk says started, then a coding agent runs on it. `hc run` when Herdr's core answers,
   * the app's own tab otherwise; a launch that fails puts the task back where it was.
   */
  startTask(task, cx) {
    cx.spawn(async (cx) => {
      const r = await tsk(statusArgs(task.number, "started"));
      if (r.code !== 0) {
        this.say("warn", lastLine(r.stderr) || `tsk status exited ${r.code}`, cx);
        cx.notify();
        this.refresh(cx);
        return;
      }
      this.expect(task, "started");
      const agent = await this.agentNow();
      if (!agent) {
        this.say("ok", `T${task.number} started · no coding agent found (set props.agent)`, cx);
      } else {
        const launched = await this.launch(task, agent);
        if (launched.ok) {
          this.say("ok", `T${task.number} started · ${agent.name} is on it`, cx);
        } else if (launched.noHc) {
          run("tab.new", launchArgs(task, agent));
          this.say("ok", `T${task.number} started · ${agent.name} is on it (no hc: the tab is untracked)`, cx);
        } else {
          await tsk(statusArgs(task.number, task.status));
          this.expect(task, task.status);
          this.say("warn", `${launched.error} · T${task.number} back to ${LABEL[task.status]}`, cx);
        }
      }
      cx.notify();
      this.refresh(cx);
    });
  }

  /**
   * `hc run` in the background: the terminal outlives this process, carries the task's label, and
   * joins this space's tab when Herdr knows it — so the panel can find it again after a restart.
   */
  async launch(task, agent) {
    const f = focused();
    const args = hcRunArgs({
      task,
      argv: await this.resolveRun(agent.run),
      brief: agentBrief(task),
      folder: task.project || home(),
      space: f ? f.space : null,
      tab: f ? f.tab : null,
    });
    const r = await hc(args).catch((e) => ({ code: 127, stdout: "", stderr: String((e && e.message) || e) }));
    if (r.code === 0) return { ok: true };
    if (r.code === 127) return { ok: false, noHc: true };
    return { ok: false, error: hcError(r.stderr) || `hc run exited ${r.code}` };
  }

  /**
   * `hc` spawns with herdr-core's own environment, which carries neither a login shell's PATH nor
   * `~/.bun/bin` — an agent Herdr calls installed can still come back "No such file or directory".
   * So the program is resolved here, where the panel's PATH is the one that found `tsk`, and handed
   * to `hc` as an absolute path. An argv that already names a path is left alone.
   */
  async resolveRun(run) {
    const argv = (run || []).map(String);
    const program = argv[0];
    if (!program || program.includes("/")) return argv;
    const r = await sh('p=$(command -v "$1" 2>/dev/null) || true; for d in "$HOME/.bun/bin" "$HOME/.local/bin" "$HOME/.npm-global/bin" "$HOME/.cargo/bin" /opt/homebrew/bin /usr/local/bin; do [ -n "$p" ] && break; [ -x "$d/$1" ] && p="$d/$1"; done; printf %s "$p"', [program]);
    const found = String(r.stdout || "").trim().split("\n").pop();
    if (found) argv[0] = found;
    return argv;
  }

  /** Stop the task's agent terminal, without touching the task's status. */
  // Done on a task whose agent has a tab asks first. Closing the tab is the tidy end — Herdr keeps a
  // finished terminal in its tab otherwise — but a tab can hold a split, so the panel never closes
  // one without being told to.
  done(task, cx) {
    const term = task.term;
    if (!term || !term.tab) {
      this.finish(task, "keep", cx);
      return;
    }
    this.confirm = this.idOf(task.id);
    cx.notify();
  }

  finish(task, how, cx) {
    const term = task.term;
    this.confirm = null;
    cx.spawn(async (cx) => {
      const r = await tsk(statusArgs(task.number, "done"));
      if (r.code !== 0) {
        this.say("warn", lastLine(r.stderr) || `tsk status exited ${r.code}`, cx);
        cx.notify();
        this.refresh(cx);
        return;
      }
      this.expect(task, "done");
      let text = `T${task.number} ${LABEL.done}`;
      if (how === "close" && term && term.tab) {
        const mates = tabMates(term, spaces());
        if (mates === 1) {
          run("tab.close", { id: term.tab, confirmed: true });
          text = `T${task.number} ${LABEL.done} \u00b7 closed ${whereLabel(term) || "its tab"}`;
        } else {
          const k = await hc(["kill", term.address]).catch((e) => ({ code: 1, stderr: String((e && e.message) || e) }));
          text = k.code === 0
            ? `T${task.number} ${LABEL.done} \u00b7 agent stopped, tab kept (${mates} terminals)`
            : `T${task.number} ${LABEL.done} \u00b7 ${hcError(k.stderr) || "could not stop the agent"}`;
        }
      }
      this.say("ok", text, cx);
      cx.notify();
      this.refresh(cx);
    });
  }

  stop(task, cx) {
    const term = task.term;
    if (!term) return;
    cx.spawn(async (cx) => {
      const r = await hc(["kill", term.address]).catch((e) => ({ code: 1, stdout: "", stderr: String((e && e.message) || e) }));
      this.say(r.code === 0 ? "ok" : "warn",
        r.code === 0 ? `T${task.number} · ${term.address} stopped` : hcError(r.stderr) || `hc kill exited ${r.code}`, cx);
      cx.notify();
      this.refresh(cx);
    });
  }

  /** Bring the agent's terminal forward: its pane when it has one, its peek otherwise. */
  show(term) {
    run("terminal.show", { terminal: term.address });
  }

  /** How often the panel refetches. Remembered per mod copy; clicking a chip refetches at once. */
  setPoll(ms, cx) {
    this.poll = ms;
    try { localStorage.setItem(POLL_KEY, String(ms)); } catch (_e) { /* storage off: the choice lives this run */ }
    if (ms) this.refresh(cx);
    else cx.notify();
  }

  /** tsk's own board, in a new tab of this space, scoped to that project's folder. */
  openBoard(project) {
    const b = boardOf(project, home());
    run("tab.new", { name: b.name, folder: b.folder, argv: ["tsk"] });
  }

  /**
   * Who the panel knows about: you, then whoever holds or is assigned anything. Kind comes from
   * tsk's own `assignee_kind`, so a person is never filed as an agent.
   */
  actorsFor(tasks) {
    const out = [{ id: "you", name: "You", kind: "you" }];
    const seen = new Set(["you"]);
    const add = (raw, kind) => {
      const id = actorIdOf(raw);
      if (!id || seen.has(id)) return;
      const person = kind === "person" || kind === "user" || id.indexOf("person:") === 0;
      const rest = id.indexOf("task:") === 0 || id.indexOf("other:") === 0;
      seen.add(id);
      out.push({
        id,
        name: String(raw).replace(/^(agent|person|user):/, ""),
        kind: person ? "person" : (rest ? "task" : "agent"),
      });
    };
    for (const task of tasks || []) {
      if (task.assignee) add(task.assignee, task.assigneeKind);
      if (task.review && task.review.on) add(task.review.on);
      if (task.block && task.block.on) add(task.block.on);
    }
    return out;
  }

  /**
   * Hand the ribbon what to draw. Called from a task phase or a click handler, never from render:
   * setShared re-renders every mod, so publishing mid-render would be a render that renders itself.
   */
  publish(now = Date.now()) {
    const tasks = [];
    for (const project of this.projects) for (const task of project.tasks) tasks.push(task);
    const actors = this.actorsFor(tasks);
    const sel = this.sel == null ? null : tasks.find((task) => task.number === this.sel) || null;
    if (this.sel != null && !sel) this.sel = null; // done, archived, or filtered away
    setShared(SEL, sel ? sel.number : null);
    setShared(TRACE, sel ? traceOf(sel, { now, actors }) : loadOf(tasks, { now, actors }));
  }

  // ---- Render ----

  render(cx) {
    if (this.role === "toggle") return toggle();
    if (this.role === "ribbon") return this.ribbon(cx);
    return this.panel(cx);
  }

  // ---- The ribbon ----

  /**
   * One instrument, two readings. With a task chosen it is that task's custody gantt — a lane per
   * actor, a bar per stretch the baton sat in their court, a bead where something happened. With
   * nothing chosen it is the board: one segment per court, sized by how many tasks sit there.
   */
  ribbon(cx) {
    const t = theme(), p = shared(TRACE) || null, W = this.width || 0;
    // The plot measures itself: the axis is drawn in px, so the width has to be real. The first
    // render has no width yet and guesses; the size event that follows corrects it once.
    const plot = (children) => div().flex_1().min_w(0).h_full().relative().overflow_hidden()
      .on_size_change((size, cx) => {
        const w = Math.round(Number(size && size.width) || 0);
        if (w > 0 && Math.abs(w - (this.width || 0)) > 4) { this.width = w; cx.notify(); }
      })
      .children(children);

    if (!p) {
      return h_flex().size_full().px(8).items_center()
        .child(note(t, "relay — whose court each task is in"));
    }
    return p.mode === "task" ? this.ribbonTask(t, p, W, plot) : this.ribbonBoard(t, p, W, plot);
  }

  /** The chosen task's custody, in lanes. Solid bar = a machine held it, outline = a person did. */
  ribbonTask(t, p, W, plot) {
    const GUT = 58, R = 6, H = 64;
    const pw = Math.max(60, (W || 860) - GUT - R);
    const now = Number(p.at) || Date.now();
    const segs = p.segments || [], events = p.events || [];
    const firsts = segs.map((s) => s.from).filter((n) => typeof n === "number");
    const earliest = firsts.length ? Math.min.apply(null, firsts) : now - 45 * 60000;
    const t0 = Math.max(earliest - 6 * 60000, now - 8 * 3600000); // at most a workday of context
    const span = Math.max(60000, now - t0);
    const x = (ms) => GUT + ((Math.max(t0, Math.min(now, ms)) - t0) / span) * pw;

    const lanes = [];
    for (const s of segs) if (!lanes.some((l) => l.id === s.actor)) lanes.push({ id: s.actor, kind: s.kind });
    // No proven custody: one lone lane of moments, so the strip never reads as "nothing happened".
    const lane = lanes.length ? lanes : [{ id: "", kind: "other" }];
    const n = lanes.length || 1;
    const laneTop = (i) => (n === 1 ? 18 : 8 + (i * 30) / (n - 1));
    const barH = n === 1 ? 10 : Math.min(10, 30 / (n - 1) - 5);
    const laneIndex = (actor) => Math.max(0, lane.findIndex((l) => l.id === actor));
    const nameOf = (id) => {
      const actor = (p.actors || []).find((a) => a.id === id);
      return actor ? actor.name : String(id);
    };

    const laneLabels = lane.map((row, i) => div().absolute().left(2).top(laneTop(i) - 1).w(GUT - 12)
      .truncate().text_size(9).text_color(t.muted).child(row.id ? nameOf(row.id) : "changes"));

    const bars = [];
    for (const s of segs) {
      const i = laneIndex(s.actor), ink = ACTOR_INK(t, s.kind);
      const left = x(s.from), right = x(s.to);
      const w = Math.max(3, right - left);
      const machine = s.kind === "agent";
      const live = Boolean(p.holder) && s.actor === p.holder.id && s.to >= now - 1000;
      // Stretch starts before the window: say so at the axis instead of pretending it began at 10:00.
      if (s.from < t0) bars.push(div().absolute().left(GUT - 4).top(laneTop(i)).w(4).h(barH).bg(ink).opacity(0.45));
      bars.push(h_flex().absolute().left(left).top(laneTop(i)).w(w).h(barH).items_center().px(4).rounded(3)
        .when(machine, (b) => b.bg(ink).opacity(live ? 0.5 : 0.85))
        .when(!machine, (b) => b.border_1().border_color(ink).opacity(live ? 0.55 : 0.8))
        .when(w >= 46 && barH >= 9, (b) => b.child(div().text_size(9)
          .text_color(machine ? t.background : ink).child(dur(s.to - s.from)))));
    }

    // A handoff is a line between the two lanes plus the bead that marks the moment.
    const joins = [];
    for (let i = 1; i < segs.length; i++) {
      const a = segs[i - 1], b = segs[i];
      if (a.actor === b.actor) continue;
      const ya = laneTop(laneIndex(a.actor)) + barH, yb = laneTop(laneIndex(b.actor));
      joins.push(div().absolute().left(Math.round(x(b.from))).top(Math.min(ya, yb)).w(1)
        .h(Math.max(1, Math.abs(yb - ya))).bg(t.border));
    }
    const beads = [];
    for (const e of events) {
      if (!(e.at >= t0 && e.at <= now)) continue;
      const seg = segs.find((s) => e.at >= s.from && e.at <= s.to);
      const kind = seg ? seg.kind : "other";
      const i = seg ? laneIndex(seg.actor) : 0;
      beads.push(div().absolute().left(x(e.at) - 2).top(laneTop(i) + barH / 2 - 2)
        .size(4).rounded_full().bg(ACTOR_INK(t, kind)));
    }

    const grid = [], ticks = [];
    const HOUR = 3600000;
    for (let ms = Math.ceil(t0 / HOUR) * HOUR; ms <= now; ms += HOUR) {
      const gx = Math.round(x(ms));
      grid.push(div().absolute().left(gx).top(4).w(1).h(42).bg(t.border).opacity(0.55));
      ticks.push(div().absolute().left(gx + 3).top(52).text_size(9).text_color(t.dim).child(clock(ms)));
    }

    const edge = [div().absolute().left(GUT + pw - 1).top(4).w(1).h(42).bg(t.border)];
    if (p.holder) {
      const i = lane.findIndex((l) => l.id === p.holder.id);
      const cy = (i >= 0 ? laneTop(i) : 18) + barH / 2;
      edge.push(div().absolute().left(GUT + pw - 3).top(cy - 3).size(6).rounded_full()
        .bg(ACTOR_INK(t, p.holder.kind)));
    }

    const hold = p.holder;
    return h_flex().size_full().px(8).gap(10).items_center()
      .child(v_flex().w(150).flex_none().gap(1)
        .child(h_flex().gap(5).items_center()
          .child(dot(STATUS_COLOR(t, p.status), 6))
          .child(div().text_size(11).font_semibold().child(`T${p.n}`))
          .child(div().text_size(9).text_color(STATUS_COLOR(t, p.status))
            .child(String(LABEL[p.status] || p.status).toUpperCase())))
        .child(div().w_full().truncate().text_size(10).text_color(t.muted).child(p.title || ""))
        .child(div().w_full().truncate().text_size(9).text_color(t.dim)
          .child(`${segs.length ? `${segs.length} ${segs.length === 1 ? "stretch" : "stretches"}` : "no record of a hand over"}${projectName(p.project) ? ` · ${projectName(p.project)}` : ""}`)))
      .child(plot(laneLabels.concat(grid, bars, joins, beads, ticks, edge)))
      .child(v_flex().w(112).flex_none().items_end().gap(1)
        .child(div().w_full().truncate().text_size(10).text_color(hold ? ACTOR_INK(t, hold.kind) : t.dim)
          .child(hold ? `holds ${hold.name}` : "no holder"))
        .child(div().text_size(9).text_color(t.dim)
          .child(hold && p.age != null ? `in court ${dur(p.age * 60000)}` : "nobody's court")));
  }

  /** Nothing chosen: how many tasks sit in each court, as one segmented strip and a legend. */
  ribbonBoard(t, p, W, plot) {
    const rows = (p.load || []).filter((r) => r.n > 0);
    const strip = h_flex().w_full().h(8).flex_none().rounded(4).overflow_hidden()
      .children(rows.map((r) => div().h_full().flex_grow(r.n).bg(ACTOR_INK(t, r.kind))
        .opacity(r.kind === "none" || r.kind === "other" ? 0.22 : 1)));
    const chips = h_flex().w_full().gap(12).items_center().overflow_hidden()
      .children(rows.map((r) => h_flex().flex_none().gap(4).items_center()
        .child(dot(ACTOR_INK(t, r.kind), 5))
        .child(div().text_size(9).text_color(r.kind === "you" ? t.foreground : t.muted)
          .child(`${r.name} ${r.n}`))));
    return h_flex().size_full().px(8).gap(12).items_center()
      .child(v_flex().w(112).flex_none().gap(2)
        .child(div().text_size(11).font_semibold().child("in court now"))
        .child(div().text_size(9).text_color(t.dim).child(`${p.total} live`)))
      .child(plot([v_flex().h_full().w_full().justify_center().gap(7).child(strip).child(chips)]))
      .child(v_flex().w(112).flex_none().items_end().gap(2)
        .child(div().text_size(10).text_color(p.needsYou ? t.accent : t.dim)
          .child(p.needsYou ? `${p.needsYou} on you` : "nothing on you"))
        .child(div().text_size(9).text_color(t.dim).child("pick one to trace")));
  }

  panel(ctx) {
    const t = theme();
    const node = find(layout(), PANEL);
    const shownNow = !(node && node.hidden);
    if (shownNow && this.wasHidden && ctx) later(ctx, (cx) => this.refresh(cx));
    this.wasHidden = !shownNow;
    if (!this.refreshed && !this.loading && ctx) later(ctx, (cx) => this.refresh(cx));

    const view = filterProjects(this.projects, this.query);
    const totals = totalsOf(this.projects);

    return v_flex().id("tsk").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden()
      .bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(S().body)
      .child(this.header(t, totals, node))
      .child(this.strip(t, totals))
      .child(this.tools(t))
      .child(this.rate(t))
      .children([this.error ? warnBox(t, this.error) : null].filter(Boolean))
      .child(div().id("projects").flex_1().min_h(0).overflow_y_scrollbar().child(this.list(t, view)))
      .children([this.notice ? this.noticeRow(t) : null].filter(Boolean))
      .child(this.footer(t));
  }

  header(t, totals, node) {
    return h_flex().h(42).flex_none().pl(12).pr(8).gap(7).items_center().border_b(1).border_color(t.border)
      .child(image("mods/tsk/mark.svg").w(17).h(17).flex_none())
      .child(div().text_size(S().title).font_semibold().child("tsk"))
      .child(div().flex_1().min_w(0).truncate().text_size(S().secondary).text_color(t.muted)
        .child(this.loadedAt ? `${this.projects.length} projects · ${totals.total} live` : "reading tsk…"))
      .child(h_flex().id("refresh").size(24).justify_center().items_center().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => this.refresh(cx)).child(icon("refresh", 13, this.loading ? t.accent : t.muted)))
      .when(Boolean(node), (el) => el.child(h_flex().id("close").size(24).justify_center().items_center().rounded(6)
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => run("layout.hide", { id: PANEL })).child(icon("close", 13, t.muted))));
  }

  /**
   * What waits on you and what is moving, in one line. Three chips at most and the
   * row clips: a 324px panel has no room for every status, and the cards carry the rest.
   */
  strip(t, totals) {
    const shown = ["review", "blocked", "started"].filter((s) => totals[s] > 0);
    const chips = shown.length
      ? shown.map((s) => {
        const loud = s === "review" || s === "blocked";
        return h_flex().flex_none().gap(4).items_center()
          .child(dot(STATUS_COLOR(t, s), 6))
          .child(div().text_size(S().label).text_color(loud ? STATUS_COLOR(t, s) : t.muted)
            .child(`${totals[s]} ${LABEL[s]}`));
      })
      : [div().text_size(S().label).text_color(t.muted).child("nothing needs you")];
    return h_flex().flex_none().h(26).px(12).gap(10).items_center()
      .child(h_flex().flex_1().min_w(0).overflow_hidden().gap(9).items_center().children(chips))
      .child(div().flex_none().text_size(S().label).text_color(t.muted).child(`${totals.done || this.done} done`));
  }

  tools(t) {
    return h_flex().flex_none().px(10).pb(8).gap(6)
      .child(h_flex().flex_1().min_w(0).h(28).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.border).bg(t.chrome)
        .child(icon("search", 12, t.muted))
        .child(Input.new(this.filter).flex_1().min_w(0).h_full().text_size(S().secondary).text_color(t.foreground)))
      .child(secondary("desk-board", "Board", t, () => run("tab.new", { name: "tsk", argv: ["tsk"] }), { h: 28, px: 8 }))
      .child(this.byChip(t));
  }

  /**
   * How the list is grouped: project cards (what ships today), whose court, or which stage.
   * One chip that cycles — three buttons do not fit beside the filter at 380px.
   */
  byChip(t) {
    const label = { project: "by project", court: "by court", stage: "by stage", map: "relay map" }[this.by] || "by project";
    return h_flex().id("by-cycle").h(28).px(7).flex_none().items_center().rounded(6).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
      .on_click((_e, cx) => this.setBy(cx))
      .child(div().text_size(S().label).text_color(t.muted).child(label));
  }

  setBy(cx) {
    this.by = BY[(BY.indexOf(this.by) + 1) % BY.length];
    try { localStorage.setItem(BY_KEY, this.by); } catch (_e) { /* storage off: the choice lives this run */ }
    cx.notify();
  }

  /** The refetch interval: chips rather than a menu, because the panel is 330px and this is one row. */
  rate(t) {
    return h_flex().flex_none().px(10).pb(8).gap(4).items_center()
      .child(icon("refresh", 11, this.poll ? t.muted : t.dim))
      .child(div().flex_none().mr(1).text_size(S().label).text_color(t.muted).child("every"))
      .children(INTERVALS.map((i) => h_flex().id(`poll-${i.ms}`).h(18).px(6).flex_none().items_center().rounded(4)
        .cursor_pointer().bg(this.poll === i.ms ? t.selected : t.chrome)
        .text_size(S().label).text_color(this.poll === i.ms ? t.foreground : t.muted)
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => this.setPoll(i.ms, cx)).child(i.label)));
  }

  list(t, projects) {
    if (!this.refreshed) {
      return v_flex().pt(2).gap(6).children([0, 1, 2].map((i) => div().mx(10).h(46).rounded(8).bg(t.chrome).opacity(1 - i * 0.2)));
    }
    if (!projects.length) {
      return v_flex().p(14).gap(6)
        .child(note(t, this.query.trim() ? "Nothing matches the filter." : "No live tasks."))
        .child(note(t, this.query.trim() ? "" : "Add one below — it lands in the space's project."));
    }
    if (this.by === "project") return v_flex().pt(2).pb(10).gap(2).children(projects.map((p) => this.card(t, p)));
    const tasks = projects.reduce((all, p) => all.concat(filterTasks(p.tasks, this.query)), []);
    if (this.by === "map") return this.map(t, tasks);
    return this.groups(t, tasks);
  }

  /**
   * The relay map: one bar per live task, longest wait at the top. The bar's length is how long the
   * task has sat in its current court and its colour is whose court that is, so the shape of the
   * list is the shape of the day — three long bars are three things to answer. A row with no clock
   * draws no bar rather than an invented one, and clicking a row traces it in the ribbon above.
   */
  map(t, tasks) {
    const m = mapOf(tasks, { now: Date.now(), actors: this.actorsFor(tasks) });
    return v_flex().pt(2).pb(10).gap(1)
      .child(h_flex().h(24).pl(10).pr(10).gap(8).items_center()
        .child(div().flex_1().text_size(S().label).text_color(t.muted).child("in court now"))
        .when(m.oldest > 0, (el) => el.child(div().text_size(S().label).text_color(t.dim)
          .child(`oldest ${ageLabel(m.oldest)}`)))
        .child(div().text_size(S().label).text_color(t.dim).child(`${m.total} live`)))
      .children(m.rows.map((r) => this.mapRow(t, r)));
  }

  mapRow(t, r) {
    const sel = this.sel === r.n, ink = ACTOR_INK(t, r.kind);
    // A rule under the title, not a wash behind it: on a dark panel a 2px line reads as a bar and
    // a 10% fill reads as nothing. `nobody` draws dimmer than a court someone actually holds.
    const solid = r.kind === "none" || r.kind === "other" ? 0.4 : (r.kind === "agent" ? 1 : 0.85);
    return v_flex().id(`map-${r.n}`).relative().overflow_hidden()
      .when(sel, (el) => el.bg(t.selected))
      .child(h_flex().h(25).pl(8).pr(8).gap(6).items_center().cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click((_e, cx) => { this.sel = r.n; this.publish(); cx.notify(); })
        .child(div().w(32).flex_none().text_size(S().label).text_color(sel ? t.foreground : t.muted).child(`T${r.n}`))
        .child(div().flex_1().min_w(0).truncate().text_size(S().secondary).child(r.title))
        .child(dot(ink, 5))
        .child(div().flex_none().text_size(S().label).text_color(t.dim).child(r.age == null ? "\u2014" : ageLabel(r.age))))
      .child(div().h(3).pl(8).pr(8).relative()
        .when(r.pct > 0, (el) => el.child(div().absolute().left(8).bottom(1).h(2).w(`${r.pct}%`).bg(ink).opacity(solid))));
  }

  /**
   * Flat groups: whose court the task is in, or which stage it sits at. No project cards, so the
   * row carries the project and the tab it lives in — and the group header carries the oldest wait,
   * because that is the number that decides what you open first.
   */
  groups(t, tasks) {
    const now = Date.now();
    const list = groupBy(tasks, this.by === "court" ? "holder" : "stage",
      { now, actors: this.actorsFor(tasks), links: this.links });
    return v_flex().pt(2).pb(10).gap(1).children(list.map((g) => v_flex().gap(1)
      .child(h_flex().h(24).pl(10).pr(10).gap(6).items_center()
        .child(dot(g.kind === "stage" ? STATUS_COLOR(t, g.key) : ACTOR_INK(t, g.kind), 5))
        .child(div().flex_1().min_w(0).truncate().text_size(S().label).text_color(t.muted).child(g.title))
        .when(g.oldest != null, (el) => el.child(div().text_size(S().label)
          .text_color(g.kind === "you" && g.oldest > 60 ? STATUS_COLOR(t, "review") : t.dim)
          .child(`oldest ${ageLabel(g.oldest)}`)))
        .child(div().text_size(S().label).text_color(t.dim).child(String(g.rows.length))))
      .children(g.rows.map((task) => this.taskRow(t, task, true)))));
  }

  card(t, p) {
    const key = this.keyOf(p), open = this.expanded.has(key), c = p.counts;
    const tasks = filterTasks(p.tasks, this.query);
    const label = `${c.total} live${p.done ? ` · ${p.done} done` : ""}`;
    return v_flex().id(`project-${this.idOf(key)}`).mx(8).rounded(8)
      .when(p.active, (el) => el.bg(t.raised).border_1().border_color(t.border))
      .child(h_flex().h(32).pl(8).pr(8).gap(6).items_center().rounded(8).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          if (open) this.expanded.delete(key); else this.expanded.add(key);
          cx.notify();
        })
        .child(icon(open ? "chevron-down" : "chevron-right", 11, t.muted))
        .when(p.active, (el) => el.child(dot(t.working, 6)))
        .child(div().flex_1().min_w(0).truncate().text_size(S().body)
          .when(p.active, (el) => el.font_semibold()).child(p.name))
        .child(div().text_size(S().label).text_color(t.muted).child(label))
        .child(h_flex().id(`board-${this.idOf(key)}`).size(22).justify_center().items_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.selected)).on_mouse_down("left", stop)
          .on_click(() => this.openBoard(p)).child(icon("terminal", 12, t.muted))))
      .child(h_flex().pl(25).pr(8).pb(7).gap(8).items_center()
        .when(open || !c.total, (el) => el.child(bar(t, p)))
        .when(c.review > 0, (el) => el.child(pill(`${c.review} review`, t, t.accent)))
        .when(c.blocked > 0, (el) => el.child(pill(`${c.blocked} blocked`, t, t.blocked)))
        .when(c.attention === 0 && c.started > 0, (el) => el.child(pill(`${c.started} started`, t, t.muted)))
        .when(c.attention === 0 && !c.started && c.ready > 0, (el) => el.child(pill(`${c.ready} ready`, t, t.done))))
      .when(open, (el) => el.child(v_flex().pb(6).gap(1)
        .children(tasks.slice(0, 60).map((task) => this.taskRow(t, task)))
        .when(Boolean(this.query.trim()) && tasks.length > 60, (el) => el.child(div().pl(25).py(3)
          .text_size(S().label).text_color(t.muted).child(`+${tasks.length - 60} more`)))));
  }

  taskRow(t, task, flat) {
    const open = this.openTask === task.id, hint = taskHint(task), term = task.term || null;
    const id = this.idOf(task.id);
    const link = linkOf(task, this.links);
    const checks = (task.review && Array.isArray(task.review.checks)) ? task.review.checks : [];
    const left = reviewLeft(task);
    // A review is not "Done", it is a judgement: name the button after it, and say how many
    // checks are still open when some are.
    const closing = task.status === "review"
      ? (left ? `Approve \u00b7 ${left} left` : "Approve")
      : "Done";
    return v_flex()
      .child(h_flex().id(`task-${id}`).h(27).pl(27).pr(8).gap(6).items_center().rounded(5).cursor_pointer()
        .hover((s) => s.bg(open ? t.selected : t.hover)).when(open, (el) => el.bg(t.selected))
        .on_mouse_down("left", stop)
        .on_click((_e, cx) => {
          this.openTask = open ? null : task.id;
          this.sel = task.number;
          this.publish();
          cx.notify();
        })
        .child(rail(t, task))
        .child(div().w(32).flex_none().text_size(S().label).text_color(t.muted).child(`T${task.number}`))
        .child(div().flex_1().min_w(0).truncate().text_size(S().secondary).child(task.title))
        // The tab the task is open in: clicking it walks there, which is the whole point of
        // holding tasks, tabs and spaces in one table.
        .when(Boolean(link), (el) => el.child(h_flex().id(`link-${id}`).h(15).max_w(64).px(3).gap(3).flex_none()
          .items_center().rounded(3).bg(t.chrome).cursor_pointer()
          .hover((s) => s.bg(t.selected)).on_mouse_down("left", stop)
          .on_click(() => {
            if (link.space) run("space.select", { id: link.space });
            if (link.tab) run("tab.select", { id: link.tab });
          })
          .child(icon("terminal", 9, link.live ? t.working : t.dim))
          .child(div().min_w(0).truncate().text_size(S().label).text_color(t.muted)
            .child(link.name || `tab ${String(link.tab || "").slice(-4)}`))))
        .when(Boolean(flat) && Boolean(task.project), (el) => el.child(div().max_w(70).flex_none().truncate()
          .text_size(S().label).text_color(t.dim).child(projectName(task.project))))
        .when(Boolean(task.assignee) && task.assignee !== "you", (el) => el.child(icon("bot", 11, t.working)))
        .when(Boolean(term), (el) => el.child(h_flex().id(`term-${id}`).h(16).px(3).gap(3).items_center()
          .rounded(4).cursor_pointer().hover((s) => s.bg(t.selected)).on_mouse_down("left", stop)
          .on_click(() => this.show(term))
          .child(icon("terminal", 11, isLive(term) ? (term.status === "working" ? t.working : t.done) : t.dim))
          .when(isLive(term) && Boolean(agentName(term)), (el) => el.child(div()
            .text_size(S().label).text_color(term.status === "working" ? t.working : t.muted)
            .child(agentName(term))))))
        .when(Boolean(task.thread), (el) => el.child(icon("thread", 11, t.muted)))
        .child(h_flex().id(`archive-${id}`).size(16).justify_center().items_center().rounded(4)
          .cursor_pointer().hover((s) => s.bg(t.selected)).on_mouse_down("left", stop)
          .on_click((_e, cx) => this.archive(task, cx))
          .child(icon("archive", 11, t.dim))))
      .when(open && checks.length > 0 && this.confirm !== id, (el) => el.child(v_flex().pl(33).pr(8).pb(2).gap(1)
        .children(checks.slice(0, 6).map((c) => h_flex().gap(5).items_center()
          .child(icon(c.state === "open" ? "circle" : "check", 9,
            c.state === "open" ? t.dim : (c.state === "fail" ? STATUS_COLOR(t, "blocked") : t.done)))
          .child(div().flex_1().min_w(0).truncate().text_size(S().label)
            .text_color(c.state === "open" ? t.muted : t.dim).child(String(c.text || "")))))))
      .when(open && this.confirm !== id, (el) => el.child(h_flex().pl(33).pr(8).pb(6).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(S().label).text_color(t.muted).child(hint || LABEL[task.status]))
        .when(Boolean(term), (el) => el.child(secondary(`go-${id}`, "Open", t, () => this.show(term), { h: 22, px: 7, size: S().label })))
        .when(isLive(term), (el) => el.child(secondary(`stop-${id}`, "Stop", t, (_e, cx) => this.stop(task, cx),
          { h: 22, px: 7, size: S().label, color: t.ansi1 })))
        // Sibling .when calls rather than one nested in the other: each .when builds its own
        // element tree, and two siblings keep the button list flat and easy to read.
        .when(task.status !== "done" && (task.status === "open" || task.status === "ready" || (task.status === "started" && !isLive(term))),
          (el) => el.child(secondary(`start-${id}`, isLive(term) ? "Restart" : "Start", t,
            (_e, cx) => this.startTask(task, cx), { h: 22, px: 7, size: S().label })))
        .when(task.status !== "done", (el) => el.child(secondary(`done-${id}`, closing, t,
          (_e, cx) => this.done(task, cx), { h: 22, px: 7, size: S().label }))))
      // Done asks about the tab it would leave behind: the agent's own tab goes with the task, a
      // split tab keeps its other terminals.
      .when(open && this.confirm === id, (el) => el.child(h_flex().id(`closeask-${id}`).pl(33).pr(8).pb(6).gap(6).items_center()
        .child(div().flex_1().min_w(0).text_size(S().label).text_color(t.muted).child("Done \u2014 close its tab too?"))
        .child(primary(`done-close-${id}`, "Done + close", t, (_e, cx) => this.finish(task, "close", cx), { h: 22, px: 7, size: S().label }))
        .child(secondary(`done-keep-${id}`, "Keep", t, (_e, cx) => this.finish(task, "keep", cx), { h: 22, px: 7, size: S().label }))
        .child(secondary(`done-x-${id}`, "\u2715", t, (_e, cx) => { this.confirm = null; cx.notify(); }, { h: 22, px: 6, size: S().label }))))
      // Who is on it and where it runs: the agent's own icon, its name, and the space / tab the
      // terminal was adopted into — the same label herdr-core gives it in the agent list.
      .when(open && Boolean(term), (el) => el.child(h_flex().id(`who-${id}`).pl(33).pr(8).pb(6).gap(5).items_center()
        .rounded(4).cursor_pointer().hover((s) => s.bg(t.hover)).on_mouse_down("left", stop)
        .on_click(() => this.show(term))
        .child(programIcon(term, 12, isLive(term) ? (term.status === "working" ? t.working : t.done) : t.dim))
        .child(div().text_size(S().label).text_color(t.muted).child(whoLine(term)))
        .when(isLive(term), (row) => row.child(div().text_size(S().label).text_color(t.dim)
          .child(`· ${term.status === "working" ? "working" : "idle"}`))))));
  }

  noticeRow(t) {
    const warn = this.notice.kind === "warn";
    return h_flex().flex_none().mx(10).mb(6).px(8).h(24).gap(6).items_center().rounded(6).bg(t.chrome)
      .child(icon(warn ? "alert" : "check", 12, warn ? t.ansi1 : t.done))
      .child(div().flex_1().min_w(0).truncate().text_size(S().label).text_color(warn ? t.ansi1 : t.muted).child(this.notice.text));
  }

  footer(t) {
    const target = this.captureTarget();
    return v_flex().flex_none().px(10).pt(8).pb(9).gap(5).border_t(1).border_color(t.border)
      .child(h_flex().gap(6).items_center().text_size(S().label).text_color(t.muted)
        .child(icon(target ? "folder" : "desk", 11, t.muted))
        .child(div().flex_1().min_w(0).truncate().child(target ? `new task → ${target.name}` : "new task → desk")))
      .child(h_flex().flex_1().min_w(0).h(30).px(8).gap(6).items_center().rounded(6).border_1().border_color(t.border).bg(t.chrome)
        .child(icon("plus", 13, t.muted))
        .child(Input.new(this.capture).flex_1().min_w(0).h_full().text_size(S().secondary).text_color(t.foreground)));
  }
}

function firstNumber(stdout) {
  try {
    const v = JSON.parse(String(stdout).trim());
    const row = Array.isArray(v) ? v[0] : v;
    return row && row.number ? row.number : 0;
  } catch (_e) { return 0; }
}
