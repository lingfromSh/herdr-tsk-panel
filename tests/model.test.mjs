// The panel's data layer, checked without Herdr: `node --test tests/`.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DONE_MARK, STATUSES, parseList, countsOf, totalsOf, projectName, matchesFolder,
  buildProjects, filterTasks, filterProjects, idOf, addArgs, statusArgs, archiveArgs, boardOf, taskHint, lastLine,
  agentBrief, pickAgent, launchArgs, hcError, agentName, whereLabel, whoLine, tabMates,
  snapshotOf, changedTasks, alertPlan, INTERVALS, DEFAULT_POLL, parsePoll, pollLabel,
  hcRunArgs, taskTerminal, isLive,
  actorIdOf, actorKindOf, actorOf, holderOf, needsYou, courtSince, ageOf, eventsOf, custodyOf,
  linksOf, linkOf, groupBy, traceOf, loadOf, mapOf, enrichTasks, RAIL, stageOf, reviewLeft,
  KEY_ACTION, keyAction, moveSel,
} from "../mods/tsk/model.js";

const task = (number, status, project, more = {}) =>
  ({ id: `id${number}`, number, status, project, title: `Task ${number}`, thread: null, assignee: null, block: null, review: null, ...more });

const listOut = (live, done) => `${JSON.stringify(live)}\n${DONE_MARK}\n${JSON.stringify(done)}\n`;

test("parseList splits live from done at the marker", () => {
  const out = listOut(
    [task(2, "started", "/w/app", { thread: "auth" }), task(1, "open", null)],
    [task(7, "done", "/w/app")],
  );
  const { live, done, error } = parseList(out);
  assert.equal(error, null);
  assert.deepEqual(live.map((t) => t.number), [2, 1]);
  assert.deepEqual(done.map((t) => t.number), [7]);
  assert.equal(live[0].thread, "auth");
  assert.equal(live[1].project, null);
});

test("parseList survives noise on stderr-ish lines and a missing done list", () => {
  assert.deepEqual(parseList(`${JSON.stringify([task(1, "open", null)])}\n${DONE_MARK}\n`).done, []);
  const noisy = parseList(`tsk: some warning\n${JSON.stringify([task(1, "open", null)])}`);
  assert.equal(noisy.live.length, 1);
  assert.match(parseList("tsk: not a repository").error, /not a repository/);
  assert.equal(parseList("").error, null);
});

test("an unknown status reads as open, so a newer tsk still lists its tasks", () => {
  const { live } = parseList(JSON.stringify([task(1, "someday", null)]));
  assert.equal(live[0].status, "open");
});

test("countsOf and totalsOf agree", () => {
  const tasks = [task(1, "review", "/w/app"), task(2, "blocked", "/w/app"), task(3, "open", "/w/app")];
  const c = countsOf(tasks);
  assert.deepEqual([c.review, c.blocked, c.open, c.total, c.attention], [1, 1, 1, 3, 2]);
  const projects = buildProjects(tasks, [task(9, "done", "/w/app")], []);
  const t = totalsOf(projects);
  assert.equal(t.total, 3);
  assert.equal(t.attention, 2);
  assert.equal(t.done, 1);
});

test("projects sort: open spaces first, then what waits on you, then size", () => {
  const live = [
    task(1, "open", "/w/quiet"),
    task(2, "open", "/w/loud"),
    task(3, "review", "/w/loud"),
    task(4, "open", "/w/held"),
    task(5, "started", "/w/held"),
    task(6, "open", null),
  ];
  const projects = buildProjects(live, [], ["/w/quiet/sub"]);
  assert.deepEqual(projects.map((p) => p.name), ["quiet", "loud", "held", "desk"]);
  assert.equal(projects[0].active, true);
  assert.equal(projects[1].counts.attention, 1);
  assert.equal(projects[3].desk, true);
  // Inside a project: attention first, then the newest number.
  const loud = projects[1];
  assert.deepEqual(loud.tasks.map((t) => t.number), [3, 2]);
});

test("projects with nothing live stay out unless a space is open in them", () => {
  const done = [task(1, "done", "/w/old"), task(2, "done", "/w/open-here")];
  assert.deepEqual(buildProjects([], done, []).map((p) => p.name), []);
  assert.deepEqual(buildProjects([], done, ["/w/open-here"]).map((p) => p.name), ["open-here"]);
  assert.equal(buildProjects([], done, [], { showDoneOnly: true }).length, 2);
  assert.equal(buildProjects([], done, ["/w/open-here"])[0].done, 1);
});

test("a space in a sub-folder still owns its project, a sibling does not", () => {
  assert.equal(matchesFolder("/w/app", "/w/app"), true);
  assert.equal(matchesFolder("/w/app", "/w/app/packages/x"), true);
  assert.equal(matchesFolder("/w/app", "/w/application"), false);
  assert.equal(matchesFolder("/w/app", null), false);
  assert.equal(matchesFolder(null, "/w/app"), false);
});

test("projectName is the last folder; the desk has none", () => {
  assert.equal(projectName("/Users/example/w/app/"), "app");
  assert.equal(projectName(null), "desk");
});

test("filterTasks matches title, thread, assignee and T number", () => {
  const tasks = [
    task(12, "open", "/w/app", { title: "Roll back the db", thread: "db-rollback", assignee: "agent" }),
    task(3, "review", "/w/app", { title: "Portal hardening" }),
  ];
  const hits = (q) => filterTasks(tasks, q).map((t) => t.number);
  assert.deepEqual(hits(""), [12, 3]);
  assert.deepEqual(hits("roll"), [12]);
  assert.deepEqual(hits("db-roll"), [12]);
  assert.deepEqual(hits("AGENT"), [12]);
  assert.deepEqual(hits("t3"), [3]);
  assert.deepEqual(hits("3"), [3]);
  assert.deepEqual(hits("nothing"), []);
});

test("filterProjects keeps a project when its name or one of its tasks matches", () => {
  const projects = buildProjects([
    task(1, "open", "/w/webapp", { title: "portal migration" }),
    task(2, "open", "/w/lumos-vault", { title: "index notes" }),
  ], [], []);
  assert.equal(filterProjects(projects, "").length, 2);
  assert.deepEqual(filterProjects(projects, "portal").map((p) => p.name), ["webapp"]);
  assert.deepEqual(filterProjects(projects, "LUMOS").map((p) => p.name), ["lumos-vault"]);
  assert.deepEqual(filterProjects(projects, "nothing"), []);
});

test("idOf strips what an element id may not hold", () => {
  assert.equal(idOf("/Users/example/w/app"), "-Users-example-w-app");
  assert.equal(idOf("15fec2dd-f640-4794"), "15fec2dd-f640-4794");
});

test("the two moves the panel offers build the right arguments", () => {
  assert.deepEqual(addArgs("Ship it", "/w/app"), ["add", "-t", "Ship it", "--json", "-p", "/w/app"]);
  assert.deepEqual(addArgs("Ship it", null), ["add", "-t", "Ship it", "--json", "--desk"]);
  assert.deepEqual(statusArgs(12, "started"), ["status", "T12", "started"]);
  assert.deepEqual(statusArgs(12, "done"), ["status", "T12", "done"]);
});

test("archive takes the task number, because tsk's delete is not on the command line", () => {
  assert.deepEqual(archiveArgs(48), ["archive", "T48"]);
  assert.deepEqual(archiveArgs(3), ["archive", "T3"]);
});

test("the board tab is named after its project and opens where tsk scopes it", () => {
  const project = { path: "/w/app", name: "app", desk: false };
  assert.deepEqual(boardOf(project, "/Users/example"), { name: "tsk app", folder: "/w/app" });
  assert.deepEqual(boardOf({ path: null, name: "desk", desk: true }, "/Users/example"), { name: "tsk desk", folder: "/Users/example" });
});

test("taskHint says what waits: a block's reason, review checks, else the thread", () => {
  assert.equal(taskHint(task(1, "blocked", "/w/a", { block: { why: "needs a token" } })), "blocked: needs a token");
  assert.equal(taskHint(task(1, "blocked", "/w/a", { block: {} })), "blocked");
  assert.equal(taskHint(task(1, "review", "/w/a", { review: { checks: [{ state: "passed" }, { state: "open" }] } })), "review · 1/2 checks");
  assert.equal(taskHint(task(1, "open", "/w/a", { thread: "portal" })), "#portal");
  assert.equal(taskHint(task(1, "open", "/w/a")), "");
});

test("lastLine is the last non-empty line, so errors do not print a stack", () => {
  assert.equal(lastLine("a\n\nb  \n"), "b");
  assert.equal(lastLine(undefined), "");
});

test("hcError unwraps hc's JSON failure, and falls back to the last line", () => {
  const spawn = '{"error":{"hint":"check the program name and cwd","kind":"spawn_failed","message":"cannot start \\"pi\\": No such file or directory (os error 2)"}}';
  assert.equal(hcError(spawn), 'cannot start "pi": No such file or directory (os error 2) (check the program name and cwd)');
  assert.equal(hcError('{"error":{"kind":"x","message":"plain"}}'), "plain");
  assert.equal(hcError("tsk: unknown task T9"), "tsk: unknown task T9");
  assert.equal(hcError("noise\n{\"error\":{\"message\":\"boom\"}}"), "boom");
  assert.equal(hcError(""), "", "nothing to say, so the caller's own message wins");
  assert.equal(hcError("{not json}"), "{not json}");
});

test("STATUSES is attention-first, and every one is a tsk status", () => {
  assert.deepEqual(STATUSES, ["review", "blocked", "started", "ready", "open"]);
});

test("agentBrief names the task, its project, and how to hand it back", () => {
  const brief = agentBrief(task(3, "open", "/w/app", { thread: "auth" }), "/w/app");
  assert.match(brief, /^tsk task T3 \(auth\) — Task 3$/m);
  assert.match(brief, /^Project: \/w\/app$/m);
  assert.match(brief, /tsk status T3 review/);
});

test("pickAgent takes props.agent by key or name, falls back to the first installed, none turns it off", () => {
  const agents = [
    { key: "claude", name: "Claude Code", run: ["claude"], installed: false },
    { key: "pi", name: "pi", run: ["pi"], installed: true },
    { key: "codex", name: "Codex", run: ["codex"], installed: true },
  ];
  assert.equal(pickAgent(agents, "codex").key, "codex");
  assert.equal(pickAgent(agents, "Codex").key, "codex");
  assert.equal(pickAgent(agents, "clau").key, "pi", "an installed agent wins over a missing one");
  assert.equal(pickAgent(agents, "").key, "pi");
  assert.equal(pickAgent(agents, null).key, "pi");
  assert.equal(pickAgent(agents, "none"), null);
  assert.equal(pickAgent([{ key: "x", name: "x", run: [], installed: true }], ""), null);
});

test("launchArgs opens a tab in the task's project, running the agent with the brief", () => {
  const t = task(9, "open", "/w/app", { thread: "db" });
  const args = launchArgs(t, { key: "pi", name: "pi", run: ["pi", "--yolo"] });
  assert.equal(args.name, "T9");
  assert.equal(args.folder, "/w/app");
  assert.deepEqual(args.argv, ["pi", "--yolo"]);
  assert.match(args.task, /T9/);
  assert.equal(launchArgs(task(9, "open", null), { run: ["pi"] }).folder, null);
});

test("changedTasks reports moves only: a first poll and an unseen task stay quiet", () => {
  const before = snapshotOf([task(1, "started", "/w/app"), task(2, "open", "/w/app")]);
  assert.deepEqual(before, { id1: "started", id2: "open" });
  assert.deepEqual(changedTasks(null, [task(1, "review", "/w/app")]), [], "no baseline, no news");

  const changes = changedTasks(before, [
    task(1, "review", "/w/app"), task(2, "open", "/w/app"), task(3, "started", "/w/app"),
  ]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].task.number, 1);
  assert.equal(changes[0].from, "started");
  assert.equal(changes[0].to, "review");
});

test("a task closed in tsk reads as a move to done, because done rows carry that status", () => {
  const seen = snapshotOf([task(4, "started", "/w/app")]);
  const changes = changedTasks(seen, [task(4, "done", "/w/app")]);
  assert.deepEqual(changes.map((c) => [c.task.number, c.to]), [[4, "done"]]);
});

test("alertPlan: one notice per move, one counted notice when a batch lands", () => {
  assert.deepEqual(alertPlan([]), []);
  const one = alertPlan([{ task: task(12, "review", "/w/app", { title: "Fix login" }), to: "review" }]);
  assert.deepEqual(one, [{ title: "tsk · review", body: "app · T12 Fix login", level: "warning" }]);
  assert.equal(alertPlan([{ task: task(5, "open", null), to: "started" }])[0].body, "desk · T5 Task 5");

  const many = [1, 2, 3, 4].map((n) => ({ task: task(n, "review", "/w/app"), to: n > 3 ? "done" : "review" }));
  assert.deepEqual(alertPlan(many), [{ title: "tsk · 4 changed", body: "3 review · 1 done", level: "info" }]);
});

test("a notice's level follows its status: a block is an error, a done task good news", () => {
  const level = (to) => alertPlan([{ task: task(1, to, "/w/a"), to }])[0].level;
  assert.equal(level("blocked"), "error");
  assert.equal(level("review"), "warning");
  assert.equal(level("done"), "success");
  assert.equal(level("started"), "info");
  assert.equal(level("ready"), "info");
});

test("the interval: named choices, numbers, and props that name nothing", () => {
  assert.deepEqual(INTERVALS.map((i) => i.label), ["off", "5s", "15s", "1m", "5m"]);
  assert.deepEqual(INTERVALS.map((i) => i.ms), [0, 5000, 15000, 60000, 300000]);
  assert.equal(parsePoll("off"), 0);
  assert.equal(parsePoll("5s"), 5000);
  assert.equal(parsePoll("5S "), 5000);
  assert.equal(parsePoll("60000"), 60000);
  assert.equal(parsePoll(null), DEFAULT_POLL);
  assert.equal(parsePoll(""), DEFAULT_POLL);
  assert.equal(parsePoll("soon"), DEFAULT_POLL);
  assert.equal(parsePoll("-1"), DEFAULT_POLL);
  assert.equal(parsePoll(undefined, 0), 0, "props may pass the fallback too");
  assert.equal(pollLabel(15000), "15s");
  assert.equal(pollLabel(0), "off");
  assert.equal(pollLabel(2000), "2s", "an interval that is not on the strip still reads");
});

test("hcRunArgs: a background terminal, named and labeled for the task, brief last", () => {
  const args = hcRunArgs({
    task: task(12, "open", "/w/app"), argv: ["pi"], brief: "do T12",
    folder: "/w/app", space: "s1", tab: "s1-t2",
  });
  assert.deepEqual(args, [
    "run", "--bg", "--json", "--no-parent", "--keep", "--name", "tsk-12", "--label", "tsk=T12",
    "--label", "herdr.space=s1", "--label", "herdr.tab=s1-t2", "--cwd", "/w/app", "--", "pi", "do T12",
  ]);
  const bare = hcRunArgs({ task: task(7, "open", null), argv: ["codex", "--yolo"] });
  assert.deepEqual(bare.slice(-3), ["--", "codex", "--yolo"], "no space, no folder, no brief");
  assert.ok(!bare.includes("--cwd"));
});

test("taskTerminal finds the label first, then the task's name, and nothing when it is gone", () => {
  const rows = [
    { address: "t4", agent: "zsh", state: "live", labels: {} },
    { address: "t9", agent: "pi", state: "live", status: "working", labels: { tsk: "T12" } },
    { address: "t11", name: "tsk-13", agent: "claude", state: "finished" },
  ];
  const found = taskTerminal(task(12, "started", "/w/app"), rows);
  assert.equal(found.address, "t9");
  assert.equal(found.agent, "pi");
  assert.equal(found.status, "working");
  assert.equal(found.state, "live");
  assert.equal(taskTerminal(task(13, "started", "/w/app"), rows).address, "t11", "a launch that never got its label");
  assert.equal(taskTerminal(task(99, "open", "/w/app"), rows), null);
  const stale = [
    { address: "t3", name: "tsk-12", state: "finished", labels: { tsk: "T12" } },
    { address: "t8", name: "tsk-12", state: "live", labels: { tsk: "T12" } },
  ];
  assert.equal(taskTerminal(task(12, "open", "/w/app"), stale).address, "t8",
    "a finished leftover loses to the run that took its place");
  assert.equal(taskTerminal(task(12, "open", "/w/app"), null), null);
});

test("whoLine names the agent and the space / tab herdr-core labeled it with", () => {
  const row = {
    address: "t6w", state: "live", status: "working", name: "tsk-54", title: "π - app",
    labels: { tsk: "T54", where: "Fosun Work / 1" },
    program: { key: "pi", name: "Pi", icon: "icons/pi.svg", tint: true },
  };
  const term = taskTerminal(task(54, "started", "/w/app"), [row]);
  assert.equal(agentName(term), "Pi", "the program's own name wins");
  assert.equal(whereLabel(term), "Fosun Work / 1");
  assert.equal(whoLine(term), "Pi · Fosun Work / 1");
  assert.deepEqual(term.program, { key: "pi", name: "Pi", icon: "icons/pi.svg", tint: true });
  assert.equal(whoLine({ program: { key: "codex" }, where: "" }), "codex", "the key when there is no name");
  assert.equal(whoLine({ name: "tsk-7" }), "tsk-7", "the terminal name when there is no program");
  assert.equal(whoLine(null), "");
});

test("tabMates counts the terminals Done would end with the tab", () => {
  const term = taskTerminal(task(54, "started", "/w/app"), [{
    address: "t6w", state: "live", name: "tsk-54",
    labels: { tsk: "T54", "herdr.space": "sp1", "herdr.tab": "tb1", where: "Fosun Work / 1" },
  }]);
  assert.equal(term.tab, "tb1");
  assert.equal(term.space, "sp1");
  const spaces = [
    { id: "sp1", tabs: [
      { id: "tb1", panes: 1 },
      { id: "tb2", panes: 2 },
    ] },
  ];
  assert.equal(tabMates(term, spaces), 1, "the agent's own tab");
  assert.equal(tabMates({ ...term, tab: "tb2" }, spaces), 2, "a split keeps its other terminal");
  assert.equal(tabMates({ ...term, tab: "tb9" }, spaces), 0, "the tab is gone");
  assert.equal(tabMates(null, spaces), 0);
  assert.equal(tabMates(term, null), 0);
});

test("isLive is the state, not a status: hc keeps a finished terminal listed", () => {
  assert.equal(isLive(taskTerminal(task(13, "open", null), [{ address: "t1", name: "tsk-13", state: "finished" }])), false);
  assert.equal(isLive(taskTerminal(task(13, "open", null), [{ address: "t1", name: "tsk-13", state: "live" }])), true);
  assert.equal(isLive(null), false);
  assert.equal(isLive(undefined), false);
});

// ---- The relay: whose court a task is in ----

const NOW = 1_800_000_000_000;
const sec = (ms) => [Math.floor(ms / 1000), (ms % 1000) * 1e6];
const mine = (n, status, more = {}) => task(n, status, "/w/app", more);

test("actorIdOf folds every spelling of a waiting party into one id", () => {
  assert.equal(actorIdOf("you"), "you");
  assert.equal(actorIdOf("me"), "you");
  assert.equal(actorIdOf("user"), "you");
  assert.equal(actorIdOf("agent:pi"), "pi");
  assert.equal(actorIdOf("person:dana"), "dana");
  assert.equal(actorIdOf("pi"), "pi", "an assignee is already a name");
  assert.equal(actorIdOf("task:T12"), "task:12", "T12 and 12 are the same task");
  assert.equal(actorIdOf("task:12"), "task:12");
  assert.equal(actorIdOf("other:design call"), "other:design call", "a stranger keeps their words");
  assert.equal(actorIdOf(""), null);
  assert.equal(actorIdOf(null), null);
  assert.equal(actorIdOf("agent:"), null);
});

test("actorKindOf reads the kind from the app's list, then from the id's own shape", () => {
  const actors = [{ id: "pi", name: "Pi", kind: "agent" }, { id: "dana", name: "Dana", kind: "person" }];
  assert.equal(actorKindOf("pi", actors), "agent");
  assert.equal(actorKindOf("dana", actors), "person");
  assert.equal(actorKindOf("you", actors), "you");
  assert.equal(actorKindOf("task:12", actors), "task");
  assert.equal(actorKindOf("other:board", actors), "other");
  assert.equal(actorKindOf("codex", actors), "agent", "an unknown name is a machine until told otherwise");
});

test("actorOf names an unknown id by itself instead of inventing a person", () => {
  const actors = [{ id: "dana", name: "Dana", kind: "person", live: false }];
  assert.deepEqual(actorOf("dana", actors), { id: "dana", name: "Dana", kind: "person", live: false });
  assert.deepEqual(actorOf("task:12", actors), { id: "task:12", name: "T12", kind: "task", live: false });
  assert.deepEqual(actorOf("other:board", actors), { id: "other:board", name: "board", kind: "other", live: false });
  assert.equal(actorOf(null, actors), null);
});

test("holderOf: review→reviewer, block→whoever is blocking, else the assignee", () => {
  assert.equal(holderOf(mine(1, "review", { review: { on: "agent:pi" } })), "pi");
  assert.equal(holderOf(mine(2, "review", { review: { on: "you" } })), "you");
  assert.equal(holderOf(mine(3, "review", { review: null })), "you", "a review with no record still needs a reader");
  assert.equal(holderOf(mine(4, "blocked", { block: { on: "person:dana" } })), "dana");
  assert.equal(holderOf(mine(5, "blocked", { block: null })), null, "a block nobody named has no holder");
  assert.equal(holderOf(mine(6, "started", { assignee: "pi", assigneeKind: "agent" })), "pi");
  assert.equal(holderOf(mine(7, "started")), null);
  assert.equal(holderOf(mine(8, "done", { review: { on: "you" } })), null);
  assert.equal(holderOf(null), null);
});

test("holderOf: an unfinished `after` holds the task, and the dependency is the actor", () => {
  assert.equal(holderOf(mine(9, "ready", { after: [{ task: 72, done: false }] })), "task:72");
  assert.equal(holderOf(mine(10, "ready", { after: [{ task: 72, done: true }], assignee: "codex" })), "codex");
  assert.equal(holderOf(mine(11, "ready", { after: [{ task: "T72", done: false }] })), "task:72");
});

test("needsYou is the two stages that stop moving until a person acts", () => {
  assert.equal(needsYou(mine(1, "review", { review: { on: "you" } })), true);
  assert.equal(needsYou(mine(2, "blocked", { block: { on: "you" } })), true);
  assert.equal(needsYou(mine(3, "review", { review: { on: "dana" } })), false);
  assert.equal(needsYou(mine(4, "started", { assignee: "me" })), false, "work in progress is not a wait on you");
  assert.equal(needsYou(mine(5, "ready", { assignee: "me" })), false);
});

test("courtSince prefers the review's own stamp, then the block's, then history, then creation", () => {
  const opened = NOW - 40 * 60000;
  assert.equal(courtSince(mine(1, "review", { review: { at: sec(opened) } })), opened);
  assert.equal(courtSince(mine(2, "blocked", { block: { since: sec(opened) } })), opened);
  assert.equal(courtSince(mine(3, "blocked", { block: { at: sec(opened) } })), opened);
  const history = [
    { kind: "created", at: sec(NOW - 300 * 60000) },
    { kind: "status_set", at: sec(NOW - 120 * 60000) },
    { kind: "status_set", at: sec(NOW - 25 * 60000) },
    { kind: "edited", at: sec(NOW - 60000) },
  ];
  assert.equal(courtSince(mine(4, "started", { history })), NOW - 25 * 60000, "the newest move, not the newest edit");
  assert.equal(courtSince(mine(5, "open", { created_at: sec(NOW - 90000) })), NOW - 90000);
  assert.equal(courtSince(mine(6, "open")), null);
  assert.equal(courtSince(null), null);
});

test("ageOf is minutes of custody, and null when the record has no clock", () => {
  assert.equal(ageOf(mine(1, "review", { review: { at: sec(NOW - 78 * 60000) } }), NOW), 78);
  assert.equal(ageOf(mine(2, "review", { review: { at: sec(NOW - 24000) } }), NOW), 0, "under a minute reads as 0");
  assert.equal(ageOf(mine(3, "review", { review: { at: sec(NOW + 60000) } }), NOW), 0, "a future stamp clamps to now");
  assert.equal(ageOf(mine(4, "open")), null);
});

test("eventsOf: beads oldest first, labelled, and one per real event", () => {
  const opened = NOW - 40 * 60000;
  const made = NOW - 400 * 60000;
  const t = mine(1, "review", {
    review: { at: sec(opened), by: "pi" },
    created_at: sec(made),
    history: [
      { kind: "status_set", at: sec(opened - 1000) },
      { kind: "status_set", at: sec(opened - 1000) },
      { kind: "step_checked", at: sec(NOW - 20000) },
      { kind: "replied", at: sec(NOW - 10000), by: "me" },
    ],
  });
  const ev = eventsOf(t);
  assert.deepEqual(ev.map((e) => e.kind), ["created", "status_set", "review", "step_checked", "replied"]);
  assert.deepEqual(ev.map((e) => e.label), ["created", "status", "review", "step ✓", "replied"]);
  assert.equal(ev[4].by, "you", "`me` reads as you");
  assert.equal(ev[1].by, null, "status_set names nobody");
  assert.ok(ev.every((e, i) => i === 0 || e.at >= ev[i - 1].at));
});

test("custodyOf, tier 1: the holder's stretch, from when it became theirs", () => {
  const opened = NOW - 78 * 60000;
  const segs = custodyOf(mine(1, "review", { review: { at: sec(opened), on: "you" } }), NOW);
  assert.deepEqual(segs, [{ actor: "you", from: opened, to: NOW, kind: "you", source: "court" }]);

  const noClock = custodyOf(mine(2, "review", { review: { on: "pi" } }), NOW);
  assert.deepEqual(noClock, [{ actor: "pi", from: null, to: NOW, kind: "agent", source: "court" }]);
  assert.deepEqual(custodyOf(mine(3, "open"), NOW), [], "nobody holding it, nothing drawn");
});

test("custodyOf, tier 2: a ledger turns moves into stretches, and the holder keeps the last one", () => {
  const t1 = NOW - 90 * 60000, t2 = NOW - 60 * 60000;
  const segs = custodyOf(
    mine(1, "review", { review: { at: sec(t2), on: "agent:codex" } }),
    NOW,
    [{ actor: "agent:pi", at: sec(t1) }, { actor: "codex", at: sec(t2) }],
  );
  assert.deepEqual(segs.map((s) => [s.actor, s.from, s.to, s.source]), [
    ["pi", t1, t2, "ledger"],
    ["codex", t2, NOW, "ledger"],
  ], "the ledger's last move is the holder, so it is not drawn twice");
  assert.equal(segs[0].kind, "agent");
});

test("custodyOf: a ledger that ends elsewhere hands the stretch to the holder", () => {
  const t1 = NOW - 90 * 60000, t2 = NOW - 10 * 60000;
  const segs = custodyOf(
    mine(1, "review", { review: { at: sec(t2), on: "you" } }),
    NOW,
    [{ actor: "pi", at: sec(t1) }],
  );
  assert.deepEqual(segs.map((s) => [s.actor, s.from, s.to, s.source]), [
    ["pi", t1, t2, "ledger"],
    ["you", t2, NOW, "observed"],
  ], "the holder's stretch starts at the review's stamp, which is later than the observed move");
});

test("custodyOf: stale moves are dropped and repeats merge into one stretch", () => {
  const t1 = NOW - 70 * 60000, t2 = NOW - 50 * 60000;
  const segs = custodyOf(mine(1, "started", { assignee: "pi" }), NOW, [
    { actor: "pi", at: sec(t1) },
    { actor: "pi", at: sec(t2) },
    { actor: "you", at: sec(NOW + 60000) },
  ]);
  assert.deepEqual(segs, [{ actor: "pi", from: t1, to: NOW, kind: "agent", source: "ledger" }]);
});

test("linksOf flattens labeled terminals and task-named tabs; linkOf prefers what is live", () => {
  const terminals = [
    { labels: { tsk: "T31" }, tab: "tb1", space: "sp1", name: "tsk-31", state: "finished" },
    { labels: { tsk: "T31" }, tab: "tb2", space: "sp1", name: "tsk-31b", state: "live" },
    { labels: {}, tab: "tb3", space: "sp1", name: "shell", state: "live" },
  ];
  const spaces = [{ id: "sp1", tabs: [{ id: "tb4", task: { number: 27 }, name: "T27 tree" }] }];
  const links = linksOf(terminals, spaces);
  assert.deepEqual(links.map((l) => [l.n, l.tab, l.live, l.via]), [
    [31, "tb1", false, "terminal"],
    [31, "tb2", true, "terminal"],
    [27, "tb4", false, "tab"],
  ]);
  assert.equal(linkOf(mine(31, "review"), links).tab, "tb2", "the running terminal wins");
  assert.equal(linkOf(mine(27, "started"), links).name, "T27 tree");
  assert.equal(linkOf(mine(99, "started"), links), null);
  assert.equal(linkOf(null, links), null);
  assert.deepEqual(linksOf(null, null), []);
});

test("groupBy: holder groups read you → agents → people → tasks → nobody, oldest wait kept", () => {
  const actors = [
    { id: "you", name: "You", kind: "you" },
    { id: "pi", name: "Pi", kind: "agent" },
    { id: "dana", name: "Dana", kind: "person" },
  ];
  const rows = [
    mine(1, "open"),
    mine(2, "started", { assignee: "pi", history: [{ kind: "status_set", at: sec(NOW - 120 * 60000) }] }),
    mine(3, "review", { review: { on: "you", at: sec(NOW - 30 * 60000) } }),
    mine(4, "review", { review: { on: "you", at: sec(NOW - 78 * 60000) } }),
    mine(5, "blocked", { block: { on: "person:dana" } }),
    mine(6, "ready", { after: [{ task: 9, done: false }] }),
  ];
  const groups = groupBy(rows, "holder", { now: NOW, actors });
  assert.deepEqual(groups.map((g) => g.key), ["you", "pi", "dana", "task:9", ""]);
  assert.deepEqual(groups.map((g) => g.title), ["You", "Pi", "Dana", "T9", "nobody"]);
  assert.deepEqual(groups[0].rows.map((t) => t.number), [4, 3], "oldest first inside a wait");
  assert.equal(groups[0].oldest, 78);
  assert.equal(groups[1].oldest, 120);
  assert.equal(groups[4].oldest, null, "a fresh inbox has no clock");
});

test("groupBy: stage order is the panel's own, space groups fall back to `no space`", () => {
  const rows = [
    mine(1, "open"), mine(2, "review", { review: { on: "you" } }), mine(3, "started", { assignee: "pi" }),
  ];
  assert.deepEqual(groupBy(rows, "stage").map((g) => g.key), ["review", "started", "open"]);

  const links = linksOf([{ labels: { tsk: "T3" }, tab: "tb", space: "sp1", state: "live" }], []);
  const bySpace = groupBy(rows, "space", { links });
  assert.deepEqual(bySpace.map((g) => g.key), ["sp1", ""]);
  assert.deepEqual(bySpace[0].rows.map((t) => t.number), [3]);
});

test("traceOf is the payload the ribbon draws: holder, stretches, beads, and when", () => {
  const opened = NOW - 45 * 60000;
  const actors = [{ id: "pi", name: "Pi", kind: "agent" }];
  const tr = traceOf(
    mine(31, "review", { title: "Drop the legacy path", review: { at: sec(opened), on: "you", by: "pi" } }),
    { now: NOW, actors },
  );
  assert.equal(tr.mode, "task");
  assert.equal(tr.n, 31);
  assert.equal(tr.at, NOW);
  assert.deepEqual(tr.holder, { id: "you", name: "you", kind: "you", live: false });
  assert.equal(tr.age, 45);
  assert.deepEqual(tr.actors, [{ id: "pi", name: "Pi", kind: "agent" }]);
  assert.deepEqual(tr.segments, [{ actor: "you", from: opened, to: NOW, kind: "you", source: "court" }]);
  assert.deepEqual(tr.events.map((e) => [e.kind, e.label, e.by]), [["review", "review", "pi"]]);
  assert.equal(traceOf(mine(1, "open"), { now: NOW }).holder, null);
});

test("loadOf: one entry per court, nobody included, with the oldest wait", () => {
  const rows = [
    mine(1, "review", { review: { on: "you", at: sec(NOW - 30 * 60000) } }),
    mine(2, "review", { review: { on: "you", at: sec(NOW - 90 * 60000) } }),
    mine(3, "started", { assignee: "pi" }),
    mine(4, "open"),
  ];
  const load = loadOf(rows, { now: NOW, actors: [{ id: "pi", name: "Pi", kind: "agent" }] });
  assert.equal(load.mode, "board");
  assert.equal(load.total, 4);
  assert.equal(load.needsYou, 2);
  assert.deepEqual(load.load.map((g) => [g.id, g.name, g.n, g.oldest]), [
    ["you", "you", 2, 90],
    ["pi", "Pi", 1, null],
    ["", "nobody", 1, null],
  ]);
  assert.deepEqual(loadOf(null).load, []);
});

test("stageOf: the pipeline, with blocked parked on started", () => {
  assert.deepEqual(RAIL, ["open", "ready", "started", "review", "done"]);
  assert.deepEqual(RAIL.map((s) => stageOf({ status: s })), [0, 1, 2, 3, 4]);
  assert.equal(stageOf({ status: "blocked" }), 2);
  assert.equal(stageOf({ status: "nonsense" }), 0);
  assert.equal(stageOf(null), 0);
});

test("reviewLeft counts only the checks still open", () => {
  assert.equal(reviewLeft(null), 0);
  assert.equal(reviewLeft({ status: "review", review: null }), 0);
  const checks = [{ text: "a", state: "open" }, { text: "b", state: "pass" }, { text: "c", state: "open" }];
  assert.equal(reviewLeft({ status: "review", review: { checks } }), 2);
  assert.equal(reviewLeft({ status: "started", review: { checks } }), 2);
  assert.equal(reviewLeft({ status: "review", review: { checks: [] } }), 0);
});

test("mapOf: longest wait first, width relative to the oldest, no clock sorts last", () => {
  const rows = [
    mine(1, "review", { review: { on: "you", at: sec(NOW - 120 * 60000) } }),
    mine(2, "started", { assignee: "pi", history: [{ kind: "status_set", at: sec(NOW - 10 * 60000) }] }),
    mine(3, "open"),
  ];
  const map = mapOf(rows, { now: NOW, actors: [{ id: "pi", name: "Pi", kind: "agent" }] });
  assert.equal(map.mode, "map");
  assert.equal(map.total, 3);
  assert.equal(map.oldest, 120);
  assert.deepEqual(map.rows.map((r) => [r.n, r.kind, r.pct]), [
    [1, "you", 100],
    [2, "agent", 8.3],
    [3, "none", 0],
  ]);
  assert.equal(map.rows[0].name, "you");
  assert.equal(map.rows[1].name, "Pi");
  assert.equal(map.rows[2].age, null);
  assert.deepEqual(mapOf(null).rows, []);
  assert.equal(mapOf([mine(4, "open")], { now: NOW }).oldest, 0);
});

test("enrichTasks folds the store's history in, without touching the list fields", () => {
  const rows = [mine(1, "open"), mine(2, "review", { review: { on: "you", at: sec(NOW - 30 * 60000) } })];
  const store = { tasks: [
    { number: 1, history: [{ kind: "status_set", at: sec(NOW - 90 * 60000) }], created_at: sec(NOW - 200 * 60000) },
    { number: 9, history: [] },
  ] };
  const out = enrichTasks(rows, store);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].history.map((e) => e.kind), ["status_set"]);
  assert.equal(out[0].status, "open");
  assert.equal(out[1].history, undefined);
  // The fold is what makes a wait datable: without it the open task has no clock, with it, 90m.
  assert.equal(courtSince(rows[0]), null);
  assert.equal(Math.round((NOW - courtSince(out[0])) / 60000), 90);
  assert.equal(enrichTasks(rows, null).length, 2);
  assert.deepEqual(enrichTasks(null, store), []);
});

test("keyAction: plain keys only, chords belong to somebody else", () => {
  assert.equal(keyAction("j"), "next");
  assert.equal(keyAction("J"), "next");
  assert.equal(keyAction("ArrowDown"), "next");
  assert.equal(keyAction("ArrowUp"), "prev");
  assert.equal(keyAction("Enter"), "open");
  assert.equal(keyAction("/"), "filter");
  assert.equal(keyAction("escape"), "clear");
  assert.equal(keyAction("j", { control: true }), null);
  assert.equal(keyAction("j", { alt: true }), null);
  assert.equal(keyAction("s", { platform: true }), null);
  assert.equal(keyAction("q"), null);
  assert.equal(keyAction("", null), null);
  assert.deepEqual(Object.keys(KEY_ACTION).sort(), ["/", "arrowdown", "arrowup", "d", "enter", "escape", "j", "k", "o", "s", "t"]);
});

test("moveSel: starts at the near end, holds at the ends, survives a vanished row", () => {
  assert.equal(moveSel([3, 5, 8], null, 1), 3);
  assert.equal(moveSel([3, 5, 8], null, -1), 8);
  assert.equal(moveSel([3, 5, 8], 5, 1), 8);
  assert.equal(moveSel([3, 5, 8], 5, -1), 3);
  assert.equal(moveSel([3, 5, 8], 8, 1), 8);
  assert.equal(moveSel([3, 5, 8], 3, -1), 3);
  assert.equal(moveSel([3, 5, 8], 99, 1), 3);
  assert.equal(moveSel([], 3, 1), null);
  assert.equal(moveSel(null, 3, 1), null);
});
