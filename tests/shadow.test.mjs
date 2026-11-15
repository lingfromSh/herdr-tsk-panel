// An own field named like a method shadows it: `this.done = 0` in init made the Approve button's
// `this.done(task, cx)` a call on a number, and QuickJS turns that TypeError into a click that does
// nothing — no error line, no notice, no status change. Nothing else in the toolchain sees it, so
// this test reads main.js as text and fails on the collision.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SOURCE = new URL("../mods/tsk/main.js", import.meta.url);
const text = () => readFileSync(SOURCE, "utf8");
const WORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try", "with"]);

/** Method names declared in a `class … { }` body: exactly two spaces of indent, `name(args) {`. */
function methods(src) {
  const names = new Set();
  const re = /^(?:export\s+default\s+)?class\s+[A-Za-z_$][\w$]*[^{]*\{$/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = src.slice(m.index + m[0].length);
    for (const line of body.split("\n")) {
      if (line === "}") break; // the class closes at column 0
      const decl = /^ {2}(?:async\s+|static\s+|get\s+|set\s+)*([A-Za-z_$][\w$]*)\s*\(/.exec(line);
      if (decl && !WORDS.has(decl[1])) names.add(decl[1]);
    }
  }
  return names;
}

/** Names assigned on `this`, wherever the assignment happens: `this.x = …`, `this.x =` alone. */
function fields(src) {
  const names = new Set();
  for (const m of src.matchAll(/this\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) names.add(m[1]);
  return names;
}

test("main.js: no own field shadows a method", () => {
  const src = text();
  const shadowed = [...methods(src)].filter((name) => fields(src).has(name)).sort();
  assert.deepEqual(shadowed, [],
    `these fields shadow a method of the same name — rename the field: ${shadowed.join(", ")}`);
});

// The scan itself has to bite, or it is a test of nothing: a field named after a method the file
// really declares (`done`) is exactly the bug that shipped.
test("the scan catches the bug it was written for", () => {
  const src = text() + "\nclass Probe extends View {\n  done(task) { return task; }\n}\nconst probe = { init() { this.done = 0; } };\n";
  const shadowed = [...methods(src)].filter((name) => fields(src).has(name));
  assert.ok(shadowed.includes("done"), "the scan missed a shadowed method name");
});
