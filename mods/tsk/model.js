// What `tsk` prints, read as the panel's data: task rows, per-project progress, and the
// arguments that add a task or move one along. No Herdr imports, so tests/model.test.mjs
// runs this file under node.

/** Attention first: a review waits on you, a block waits on someone, started work is moving. */
export const STATUSES = ["review", "blocked", "started", "ready", "open"];
export const LABEL = { review: "review", blocked: "blocked", started: "started", ready: "ready", open: "open", done: "done" };

/** Splits the two lists in one exec: live tasks, then done ones. */
export const DONE_MARK = "@@tsk-done@@";
export const LIST = `tsk list --all --json
printf "\\n${DONE_MARK}\\n"
tsk list --all --done --json`;

/** Installers put tsk in ~/.local/bin; an exec's PATH need not have it. */
export const PATHS = 'PATH="$HOME/.local/bin:$HOME/go/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH';

// ---- How often the panel refetches ----

/** The refresh choices in the panel's strip. 0 never polls; the refresh button still works. */
export const INTERVALS = [
  { ms: 0, label: "off" },
  { ms: 5000, label: "5s" },
  { ms: 15000, label: "15s" },
  { ms: 60000, label: "1m" },
  { ms: 300000, label: "5m" },
];
export const DEFAULT_POLL = 15000;

/** A stored choice, a layout prop, or the default, read as ms: a label ("off", "5s", "1m") or a number. */
export function parsePoll(value, fallback = DEFAULT_POLL) {
  if (value === null || value === undefined || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  const named = INTERVALS.find((i) => i.label === text);
  if (named) return named.ms;
  const ms = Number(text);
  if (!isFinite(ms) || ms < 0) return fallback;
  return Math.round(ms);
}

/** The chip label for an interval: the named one, else its seconds. */
export function pollLabel(ms) {
  const hit = INTERVALS.find((i) => i.ms === ms);
  return hit ? hit.label : `${Math.round(Number(ms || 0) / 1000)}s`;
}

export function lastLine(text) {
  const lines = String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : "";
}

function parseRows(text) {
  const s = String(text ?? "").trim();
  if (!s) return { rows: [], error: null };
  // A notice on the same stream would break JSON.parse: take the array between the outermost brackets.
  const from = s.indexOf("["), to = s.lastIndexOf("]");
  const body = from >= 0 && to > from ? s.slice(from, to + 1) : s;
  try {
    const value = JSON.parse(body);
    if (!Array.isArray(value)) return { rows: [], error: "tsk list did not print an array" };
    return { rows: value.map(normalize), error: null };
  } catch (e) {
    return { rows: [], error: lastLine(s) || String((e && e.message) || e) };
  }
}

function normalize(row) {
  const status = String(row && row.status ? row.status : "open");
  return {
    id: String(row && row.id ? row.id : ""),
    number: Number(row && row.number) || 0,
    title: String((row && row.title) || ""),
    status: STATUSES.indexOf(status) >= 0 ? status : status === "done" ? "done" : "open",
    project: row && row.project != null ? String(row.project) : null,
    thread: row && row.thread ? String(row.thread) : null,
    assignee: row && row.assignee ? String(row.assignee) : null,
    assigneeKind: row && row.assignee_kind ? String(row.assignee_kind) : null,
    after: row && Array.isArray(row.after) ? row.after : null,
    block: (row && row.block) || null,
    review: (row && row.review) || null,
  };
}

/** { live, done, error } from the LIST script's stdout. */
export function parseList(stdout) {
  const text = String(stdout ?? "");
  const at = text.indexOf(DONE_MARK);
  const live = parseRows(at < 0 ? text : text.slice(0, at));
  const done = parseRows(at < 0 ? "" : text.slice(at + DONE_MARK.length));
  return { live: live.rows, done: done.rows, error: live.error || done.error || null };
}

export function countsOf(tasks) {
  const c = { review: 0, blocked: 0, started: 0, ready: 0, open: 0, total: tasks.length };
  for (const t of tasks) if (c[t.status] !== undefined) c[t.status] += 1;
  c.attention = c.review + c.blocked;
  return c;
}

export const projectName = (path) => String(path ?? "").split("/").filter(Boolean).pop() ?? "desk";

/** A space in a sub-folder of a project still counts as that project. */
export const matchesFolder = (project, folder) =>
  Boolean(project && folder) && (folder === project || String(folder).startsWith(`${project}/`));

/** Board order inside a project: whatever waits on you first, then the newest. */
const byAttention = (a, b) => {
  const d = STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status);
  return d !== 0 ? d : b.number - a.number;
};

/**
 * One entry per project (the desk is `path: null`), with its live tasks and its done count.
 * `folders` are the open spaces' folders: a project holding one sorts first and shows as
 * active. Projects with nothing live are left out unless they hold an open space, or
 * `showDoneOnly` asks for them.
 */
export function buildProjects(live, done, folders = [], { showDoneOnly = false } = {}) {
  const projects = new Map();
  const at = (path) => {
    if (!projects.has(path)) {
      projects.set(path, { path, name: path ? projectName(path) : "desk", desk: !path, tasks: [], done: 0, active: false });
    }
    return projects.get(path);
  };
  for (const task of live) at(task.project).tasks.push(task);
  for (const task of done) at(task.project).done += 1;
  const out = [];
  for (const p of projects.values()) {
    p.tasks.sort(byAttention);
    p.counts = countsOf(p.tasks);
    p.total = p.counts.total + p.done;
    p.active = folders.some((f) => matchesFolder(p.path, f));
    if (!p.counts.total && !p.active && !showDoneOnly) continue;
    out.push(p);
  }
  return out.sort((a, b) =>
    Number(b.active) - Number(a.active) ||
    b.counts.attention - a.counts.attention ||
    b.total - a.total ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The portfolio's shape: every status summed across projects, plus the done count. */
export function totalsOf(projects) {
  const sum = { review: 0, blocked: 0, started: 0, ready: 0, open: 0, total: 0, attention: 0, done: 0 };
  for (const p of projects) {
    for (const s of [...STATUSES, "total", "attention"]) sum[s] += p.counts[s];
    sum.done += p.done;
  }
  return sum;
}

// ---- Status changes: what a desktop notification is about ----

/** id → status for every task in this poll: live and done alike. */
export function snapshotOf(tasks) {
  const seen = {};
  for (const t of tasks) if (t.id) seen[t.id] = t.status;
  return seen;
}

/** Tasks whose status moved since `seen`. One nobody had seen yet is not a change, so a first poll is quiet. */
export function changedTasks(seen, tasks) {
  const out = [];
  if (!seen) return out;
  for (const t of tasks) {
    const was = seen[t.id];
    if (was && was !== t.status) out.push({ task: t, from: was, to: t.status });
  }
  return out;
}

/** More than this many moves in one refetch arrive as one counted notice, not a stack of them. */
export const ALERTS_MAX = 3;

/** The notices for a refetch's changes: one per task, or a single summary when a batch landed. */
export function alertPlan(changes) {
  if (!changes || !changes.length) return [];
  if (changes.length > ALERTS_MAX) {
    const counts = {};
    for (const c of changes) counts[c.to] = (counts[c.to] || 0) + 1;
    const body = [...STATUSES, "done"].filter((s) => counts[s]).map((s) => `${counts[s]} ${LABEL[s]}`).join(" · ");
    return [{ title: `tsk · ${changes.length} changed`, body, level: "info" }];
  }
  return changes.map((c) => ({
    title: `tsk · ${LABEL[c.to] || c.to}`,
    body: `${c.task.project ? projectName(c.task.project) : "desk"} · T${c.task.number} ${c.task.title}`,
    level: levelOf(c.to),
  }));
}

/** A notice's weight: a block needs an answer, a done task is good news. */
const levelOf = (status) => ({
  blocked: "error", review: "warning", done: "success",
}[status] || "info");

/** Tasks matching a filter: title, thread, assignee, or its T number. */
export function filterTasks(tasks, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter((t) =>
    t.title.toLowerCase().includes(q) ||
    String(t.thread ?? "").toLowerCase().includes(q) ||
    String(t.assignee ?? "").toLowerCase().includes(q) ||
    `t${t.number}` === q || String(t.number) === q);
}

/** Projects to show for a filter: the name matched, or at least one task inside it did. */
export function filterProjects(projects, query) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return projects;
  return projects.filter((p) => p.name.toLowerCase().includes(q) || filterTasks(p.tasks, q).length > 0);
}

/** Element ids built from paths and uuids: only what an id may hold. */
export const idOf = (key) => String(key ?? "").replace(/[^A-Za-z0-9_.-]/g, "-");

/** `tsk add` arguments: into `project`, or onto the desk when it is null. */
export function addArgs(title, project) {
  const args = ["add", "-t", String(title), "--json"];
  return project ? [...args, "-p", project] : [...args, "--desk"];
}

/** `tsk status` arguments: `started` and `done` are the two moves the panel offers. */
export const statusArgs = (number, status) => ["status", `T${number}`, status];

/**
 * `tsk archive` arguments: off every working view, number and status kept. tsk has no delete on the
 * command line, so this is the panel's "remove": `tsk unarchive T<n>` puts the task straight back.
 */
export const archiveArgs = (number) => ["archive", `T${number}`];

/** The board tab for a project: its name, and the folder tsk opens it in. */
export function boardOf(project, home) {
  return { name: `tsk ${project.name}`, folder: project.path ?? home };
}

/** One line under a task: what blocks it, what a review checks, or its thread. */
export function taskHint(task) {
  if (task.block) {
    const why = String(task.block.why ?? "").trim();
    return why ? `blocked: ${why}` : "blocked";
  }
  if (task.review) {
    const checks = Array.isArray(task.review.checks) ? task.review.checks : [];
    const open = checks.filter((c) => c && c.state === "open").length;
    return checks.length ? `review · ${checks.length - open}/${checks.length} checks` : "review";
  }
  return task.thread ? `#${task.thread}` : "";
}

/** The pipeline a task walks. `blocked` is not a stage: it parks on `started`. */
export const RAIL = ["open", "ready", "started", "review", "done"];

/** How far along that pipeline a task is, as an index into RAIL. */
export function stageOf(task) {
  const status = task && task.status;
  if (status === "blocked") return RAIL.indexOf("started");
  const i = RAIL.indexOf(status);
  return i < 0 ? 0 : i;
}

/** Review checks still open — what an Approve button counts down. Zero when there is no review. */
export function reviewLeft(task) {
  const checks = (task && task.review && Array.isArray(task.review.checks)) ? task.review.checks : [];
  return checks.filter((c) => c && c.state === "open").length;
}

/** The first message a coding agent gets when a task's Start is pressed. */
export function agentBrief(task, projectPath) {
  const where = task.project || projectPath || "";
  return [
    `tsk task T${task.number}${task.thread ? ` (${task.thread})` : ""} — ${task.title}`,
    where ? `Project: ${where}` : "",
    "The rest of the record is in tsk: `tsk list --all --json` (and `tsk help`).",
    `Do the work, then hand it back for review: \`tsk status T${task.number} review\`.`,
  ].filter(Boolean).join("\n");
}

/** Which agent to start: props.agent by key or name ("none" turns it off), else the most picked installed one. */
export function pickAgent(agents, want) {
  const list = (agents || []).filter((a) => a && a.installed && Array.isArray(a.run) && a.run.length > 0);
  const w = String(want ?? "").trim().toLowerCase();
  if (w === "none") return null;
  if (!list.length) return null;
  if (!w) return list[0];
  return list.find((a) => String(a.key).toLowerCase() === w || String(a.name).toLowerCase() === w)
    || list.find((a) => String(a.key).toLowerCase().includes(w) || String(a.name).toLowerCase().includes(w))
    || list[0];
}

/** `tab.new` arguments that start `agent` on `task`, in the task's project folder. */
export function launchArgs(task, agent) {
  return { name: `T${task.number}`, folder: task.project || null, argv: agent.run, task: agentBrief(task) };
}

// ---- The agent's terminal, found again by the label hc was given ----

/** The label every terminal Start opens carries, and the one the panel reads back. */
export const taskLabel = (number) => `T${number}`;

/**
 * `hc --name`: lowercase letters, digits, `-` and `_`, and not shaped like a terminal id —
 * `T12` is refused as uppercase and `t12` as an id, so the name is `tsk-12`.
 */
export const taskName = (number) => `tsk-${number}`;

/**
 * `hc run` arguments for a task's agent: a background terminal that outlives both this
 * process and the terminal it was started from, labeled so the panel finds it again, and
 * adopted into `space`/`tab` when Herdr knows them.
 */
export function hcRunArgs({ task, argv, brief, folder, space, tab }) {
  const args = ["run", "--bg", "--json", "--no-parent", "--keep", "--name", taskName(task.number),
    "--label", `tsk=${taskLabel(task.number)}`];
  if (space && tab) args.push("--label", `herdr.space=${space}`, "--label", `herdr.tab=${tab}`);
  if (folder) args.push("--cwd", folder);
  args.push("--");
  for (const arg of argv || []) args.push(String(arg));
  if (brief) args.push(String(brief));
  return args;
}

/**
 * `hc` reports failures as one JSON object on stderr (`{"error":{"message":…,"hint":…}}`), which
 * reads as noise in a notice: show the message, with the hint after it. Anything else is the last line.
 */
export function hcError(text) {
  const raw = String(text || "").trim();
  const last = raw.split("\n").pop() || "";
  if (last.startsWith("{")) {
    try {
      const error = JSON.parse(last).error;
      if (error && error.message) return error.hint ? `${error.message} (${error.hint})` : String(error.message);
    } catch (e) {
      // not JSON after all: the last line is the message
    }
  }
  return lastLine(raw);
}

/** The terminal record without the fields the panel never reads. */
const terminalOf = (row) => ({
  address: String(row.address || ""),
  agent: String(row.agent || ""),
  cwd: row.cwd ? String(row.cwd) : null,
  state: String(row.state || ""),
  status: row.status ? String(row.status) : null,
  name: row.name ? String(row.name) : "",
  title: row.title ? String(row.title) : "",
  where: row.labels && row.labels.where ? String(row.labels.where) : "",
  space: row.labels && row.labels["herdr.space"] ? String(row.labels["herdr.space"]) : "",
  tab: row.labels && row.labels["herdr.tab"] ? String(row.labels["herdr.tab"]) : "",
  program: row.program
    ? {
      key: String(row.program.key || ""),
      name: String(row.program.name || ""),
      icon: row.program.icon ? String(row.program.icon) : "",
      tint: Boolean(row.program.tint),
    }
    : null,
});

/**
 * Who runs the task, in the app's own words: the program's name (`Pi`), its key (`pi`), then the
 * record's agent or terminal name. Empty when the task has no terminal.
 */
export function agentName(term) {
  if (!term) return "";
  const p = term.program || {};
  return p.name || p.key || term.agent || term.name || "";
}

/**
 * Where it runs, as herdr-core already labels it: `Fosun Work / 1` is space / tab. `hc run` is given
 * `herdr.space` and `herdr.tab`, and the core turns them into that label on the terminal itself.
 */
export const whereLabel = (term) => (term && term.where ? term.where : "");

/** `Pi · Fosun Work / 1`: the agent and the tab it sits in, for the row that explains a task. */
export function whoLine(term) {
  return [agentName(term), whereLabel(term)].filter(Boolean).join(" \u00b7 ");
}

/**
 * How many terminals share the tab a task's agent was adopted into. 1 means the tab is the agent's
 * own, so closing it ends nothing else; more means a split the panel must not take down with it;
 * 0 means the tab is gone and there is nothing left to close. `spaces()` gives a tab's `panes` as a
 * count, not a list.
 */
export function tabMates(term, spaceList) {
  if (!term || !term.tab) return 0;
  const list = Array.isArray(spaceList) ? spaceList : [];
  for (const space of list) {
    const tabs = Array.isArray(space && space.tabs) ? space.tabs : [];
    for (const tab of tabs) {
      if (!tab || tab.id !== term.tab) continue;
      return typeof tab.panes === "number" ? tab.panes : 0;
    }
  }
  return 0;
}

/**
 * The task's agent terminal out of Herdr's live `terminals()`: a running one carrying the
 * label wins, then a running one named after the task (a launch that never got its label),
 * then the leftover of an earlier run. Null when the task never had one.
 */
export function taskTerminal(task, terminals) {
  const rows = Array.isArray(terminals) ? terminals.filter(Boolean) : [];
  const labeled = (r) => r.labels && r.labels.tsk === taskLabel(task.number);
  const named = (r) => r.name === taskName(task.number);
  const live = (r) => r.state === "live";
  const found = rows.find((r) => labeled(r) && live(r))
    || rows.find((r) => named(r) && live(r))
    || rows.find(labeled)
    || rows.find(named);
  return found ? terminalOf(found) : null;
}

/** A terminal that is still running. `--keep` leaves a finished one listed, never live. */
export const isLive = (term) => Boolean(term) && term.state === "live";

// ---- The relay: whose court a task is in, and for how long ----

/**
 * The actor id inside tsk's `on` / `assignee` fields, in one space: `you`, an agent's or a
 * person's name, or `task:<n>` for "waiting on another task". `agent:` / `person:` prefixes are
 * dropped, `me` is you, and anything else (`other:<text>`) is kept as it was written.
 */
export function actorIdOf(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (text === "me" || text === "you" || text === "user") return "you";
  const at = text.indexOf(":");
  if (at < 0) return text;
  const kind = text.slice(0, at).toLowerCase();
  const rest = text.slice(at + 1).trim();
  if (!rest) return null;
  if (kind === "agent" || kind === "person") return rest;
  if (kind === "user") return "you";
  // `task:T12` and `task:12` name the same task
  if (kind === "task") return `task:${rest.replace(/^T/i, "")}`;
  return text;
}

/** How an actor id reads: the kind picks the glyph and the ink, so a name never has to. */
export function actorKindOf(id, actors = []) {
  const hit = (actors || []).find((a) => a && a.id === id);
  if (hit && hit.kind) return String(hit.kind);
  const text = String(id ?? "");
  if (text === "you") return "you";
  if (text.startsWith("task:")) return "task";
  if (text.startsWith("other:")) return "other";
  return "agent";
}

function defaultActorName(id) {
  if (id === "you") return "you";
  if (id.startsWith("task:")) return `T${id.slice(5)}`;
  if (id.startsWith("other:")) return id.slice(6);
  return id;
}

/** The actor record for an id: a known one keeps its name, an unknown one is named by its id. */
export function actorOf(id, actors = []) {
  if (!id) return null;
  const hit = (actors || []).find((a) => a && a.id === id);
  return {
    id,
    name: hit && hit.name ? String(hit.name) : defaultActorName(id),
    kind: actorKindOf(id, actors),
    live: Boolean(hit && hit.live),
  };
}

/**
 * Whose court the baton is in. The holder is the one thing the record always tells us: a review
 * belongs to its reviewer (`review.on`, or you when the record is missing), a block to
 * `block.on`, work in progress to whoever it is assigned to, and a task held behind an unfinished
 * `after` to that task. Null when nobody holds it.
 */
export function holderOf(task) {
  if (!task) return null;
  const status = String(task.status ?? "");
  if (status === "review") return actorIdOf(task.review && task.review.on) || "you";
  if (status === "blocked") return actorIdOf(task.block && task.block.on);
  if (status === "done") return null;
  const after = Array.isArray(task.after) ? task.after : [];
  const waiting = after.find((a) => a && a.done === false);
  if (waiting) return `task:${String(waiting.task).replace(/^T/i, "")}`;
  return actorIdOf(task.assignee);
}

/** It is on you and it is not moving: a review to answer, a block to lift. */
export const needsYou = (task) =>
  holderOf(task) === "you" && (task.status === "review" || task.status === "blocked");

/** tsk stamps are `[sec, nsec]` pairs; a plain number is read as seconds or ms, whichever fits. */
function stampMs(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const sec = Number(value[0]);
    if (!isFinite(sec)) return null;
    return Math.round(sec * 1000 + Number(value[1] || 0) / 1e6);
  }
  const n = Number(value);
  if (!isFinite(n) || n <= 0) return null;
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
}

const historyOf = (task) => (task && Array.isArray(task.history) ? task.history : []);

/**
 * When the baton reached its current holder, in ms: `review.at` for a review, the block's own
 * stamp when tsk wrote one, else the newest `status_set` in the task's history, else when the task
 * was created. Null when the record carries no clock at all.
 */
export function courtSince(task) {
  if (!task) return null;
  if (task.status === "review" && task.review) {
    const at = stampMs(task.review.at);
    if (at != null) return at;
  }
  if (task.status === "blocked" && task.block) {
    const at = stampMs(task.block.at);
    if (at != null) return at;
    const since = stampMs(task.block.since);
    if (since != null) return since;
  }
  const sets = historyOf(task)
    .filter((e) => e && e.kind === "status_set")
    .map((e) => stampMs(e.at))
    .filter((n) => n != null);
  if (sets.length) return Math.max(...sets);
  return stampMs(task.created_at);
}

/** How long the holder has had it, in minutes. Null when nothing in the record says. */
export function ageOf(task, now = Date.now()) {
  const since = courtSince(task);
  if (since == null) return null;
  return Math.max(0, Math.round((Number(now) - since) / 60000));
}

const EVENT_LABEL = {
  status_set: "status", created: "created", completed: "completed", archived: "archived",
  edited: "edited", replied: "replied", check_set: "check", step_added: "step +",
  step_checked: "step \u2713", step_unchecked: "step \u2717", step_renamed: "step \u270e",
  step_removed: "step \u2212", review: "review", blocked: "blocked",
};

/**
 * The beads on a bar: everything the record says happened, oldest first, as `{at, kind, by, label}`.
 * Straight from `history` when the caller read the store; the lean feed only yields the review
 * opening and the creation, which is still two true points.
 */
export function eventsOf(task) {
  const out = [];
  const seen = new Set();
  const add = (rawAt, kind, by) => {
    const at = stampMs(rawAt);
    if (at == null) return;
    const key = `${kind}:${at}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ at, kind, by: by ? actorIdOf(by) : null, label: EVENT_LABEL[kind] || String(kind).replace(/_/g, " ") });
  };
  for (const e of historyOf(task)) if (e) add(e.at, String(e.kind || ""), e.by);
  if (task && task.review) add(task.review.at, "review", task.review.by);
  if (task) add(task.created_at, "created", null);
  return out.sort((a, b) => a.at - b.at);
}

const closeSegs = (segs) => {
  const out = [];
  for (const s of segs) {
    // a stretch that begins and ends in the same instant says nothing a bead does not
    if (s.from != null && s.to != null && s.to <= s.from) continue;
    const last = out[out.length - 1];
    if (last && last.actor === s.actor && last.to === s.from && last.source === s.source) last.to = s.to;
    else out.push({ ...s });
  }
  return out;
};

/**
 * The stretches of custody, oldest first: `{actor, from, to, kind, source}`. A ledger entry
 * (`{actor, at}` — this mod watching the baton move) gives a real handoff time; without one the
 * only provable stretch is the current holder's, from `courtSince` to now. A lane is never
 * invented: no holder and no ledger means no segments.
 */
export function custodyOf(task, now = Date.now(), ledger = []) {
  const end = Number(now);
  const moves = (Array.isArray(ledger) ? ledger : [])
    .map((e) => ({ actor: actorIdOf(e && e.actor), at: stampMs(e && e.at) }))
    .filter((e) => e.actor && e.at != null && e.at <= end)
    .sort((a, b) => a.at - b.at);

  const holder = holderOf(task);
  const since = courtSince(task);
  const lastMove = moves[moves.length - 1];
  // the move that ended the ledger's last stretch: the holder's takeover, when the holder is new
  const takeover = holder && !(lastMove && lastMove.actor === holder)
    ? (lastMove
      ? Math.max(lastMove.at, since == null ? lastMove.at : Math.min(since, end))
      : (since == null ? null : Math.min(since, end)))
    : null;

  const segs = moves.map((m, i) => {
    const next = i + 1 < moves.length ? moves[i + 1].at : (takeover == null ? end : takeover);
    return { actor: m.actor, from: m.at, to: next, kind: actorKindOf(m.actor), source: "ledger" };
  });

  if (holder && takeover != null) {
    segs.push({
      actor: holder,
      from: takeover,
      to: end,
      kind: actorKindOf(holder),
      source: lastMove ? "observed" : "court",
    });
  } else if (holder && !lastMove) {
    const from = since == null ? null : Math.min(since, end);
    segs.push({ actor: holder, from, to: end, kind: actorKindOf(holder), source: "court" });
  }
  return closeSegs(segs);
}

/** A tab's task number, however the tab spells it: `task: 12`, `task: {number: 12}`, `tsk="T12"`. */
function tabTaskOf(value) {
  if (value == null) return null;
  if (typeof value === "object") return tabTaskOf(value.number);
  const n = Number(String(value).replace(/^T/i, ""));
  return isFinite(n) && n > 0 ? n : null;
}

/**
 * Every place a task can be open, flat: an agent's terminal carries `tsk=T<n>` in its labels
 * (`hc run` is given it), and a tab may name a task itself. The CRLF of the caller's adapters stays
 * in `main.js`; this only needs the plain fields.
 */
export function linksOf(terminals = [], spaces = []) {
  const out = [];
  for (const row of Array.isArray(terminals) ? terminals : []) {
    if (!row) continue;
    const labels = row.labels || {};
    const n = tabTaskOf(labels.tsk);
    if (!n) continue;
    out.push({
      n,
      tab: row.tab ? String(row.tab) : null,
      space: row.space ? String(row.space) : null,
      name: String(row.title || row.name || ""),
      live: String(row.state || "") === "live",
      via: "terminal",
    });
  }
  for (const space of Array.isArray(spaces) ? spaces : []) {
    if (!space) continue;
    for (const tab of Array.isArray(space.tabs) ? space.tabs : []) {
      if (!tab) continue;
      const n = tabTaskOf(tab.task);
      if (!n) continue;
      if (out.some((l) => l.n === n && l.tab === tab.id)) continue;
      out.push({
        n,
        tab: tab.id ? String(tab.id) : null,
        space: space.id ? String(space.id) : null,
        name: String(tab.name || ""),
        live: Boolean(tab.live),
        via: "tab",
      });
    }
  }
  return out;
}

/** Where the task is open right now: the live tab first, then any tab that names it. Null if none. */
export function linkOf(task, links = []) {
  if (!task) return null;
  const hits = (Array.isArray(links) ? links : []).filter((l) => l && l.n === task.number);
  return hits.find((l) => l.live) || hits[0] || null;
}

/** Inside a group: whatever waits on you first, then the newest — the board's own order. */
const GROUP_KIND_ORDER = { you: 0, agent: 1, person: 2, task: 3, other: 4, none: 5 };

/**
 * The board grouped by who must act next (`holder`), by stage, or by space: `{key, title, kind,
 * rows, oldest}` per group, groups in the order a person reads them. `oldest` is the age in minutes
 * of the longest wait inside the group, or null when no row carries a clock.
 */
export function groupBy(tasks, by = "holder", { now = Date.now(), actors = [], links = [] } = {}) {
  const groups = new Map();
  const at = (key, title, kind) => {
    if (!groups.has(key)) groups.set(key, { key, title, kind, rows: [], oldest: null });
    return groups.get(key);
  };
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task) continue;
    let g;
    if (by === "stage") {
      g = at(task.status, LABEL[task.status] || String(task.status), "stage");
    } else if (by === "space") {
      const link = linkOf(task, links);
      g = link && link.space ? at(link.space, link.space, "space") : at("", "no space", "space");
    } else {
      const id = holderOf(task);
      const actor = actorOf(id, actors);
      g = id ? at(id, actor.name, actor.kind) : at("", "nobody", "none");
    }
    g.rows.push(task);
    const age = ageOf(task, now);
    if (age != null && (g.oldest == null || age > g.oldest)) g.oldest = age;
  }
  const out = [...groups.values()];
  for (const g of out) g.rows.sort(byAttention);
  const rank = (g) => {
    if (by === "stage") return STATUSES.indexOf(g.key) >= 0 ? STATUSES.indexOf(g.key) : STATUSES.length;
    if (by === "space") return g.key ? 0 : 1;
    return GROUP_KIND_ORDER[g.kind] != null ? GROUP_KIND_ORDER[g.kind] : 9;
  };
  return out.sort((a, b) =>
    rank(a) - rank(b) ||
    b.rows.length - a.rows.length ||
    (b.oldest || 0) - (a.oldest || 0) ||
    (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

/**
 * Everything the ribbon draws about one task: the holder, the stretches of custody, the beads.
 * `at` is the right edge of the axis, so a viewer can tell a stale payload from a live one.
 */
export function traceOf(task, { now = Date.now(), actors = [], ledger = [] } = {}) {
  return {
    mode: "task",
    n: task.number,
    title: String(task.title ?? ""),
    project: task.project ? String(task.project) : null,
    status: task.status,
    holder: actorOf(holderOf(task), actors),
    since: courtSince(task),
    age: ageOf(task, now),
    segments: custodyOf(task, now, ledger),
    events: eventsOf(task),
    actors: (Array.isArray(actors) ? actors : []).map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    at: Number(now),
  };
}

/** The board's trace — what the ribbon shows with nothing selected: how many tasks sit in each court. */
export function loadOf(tasks, { now = Date.now(), actors = [] } = {}) {
  const list = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
  const groups = groupBy(list, "holder", { now, actors });
  return {
    mode: "board",
    at: Number(now),
    total: list.length,
    needsYou: list.filter(needsYou).length,
    load: groups.map((g) => ({ id: g.key, name: g.title, kind: g.kind, n: g.rows.length, oldest: g.oldest })),
    actors: (Array.isArray(actors) ? actors : []).map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
  };
}
