import test from "node:test";
import assert from "node:assert/strict";
import { DocumentHistory } from "../public/core/document-history.js";

function documentAt(line, derivation = "proof-a", x = 100) {
  const history = Array.from({ length: line + 1 }, (_, index) => ({
    expression: {
      id: index === 0 ? derivation : `${derivation}-line-${index}`,
      type: "probability",
      probability: {
        outcome: ["y"],
        intervention: [],
        observation: index === 0 ? [] : [`z${index}`],
      },
    },
    certificate: index === 0 ? null : { kind: "fixture", line: index },
  }));
  return {
    graph: { nodes: [{ id: "y", label: "y", x, y: 100 }], edges: [] },
    initial: structuredClone(history[0].expression.probability),
    current: structuredClone(history.at(-1).expression),
    history,
  };
}

function progression(lastLine) {
  const history = new DocumentHistory();
  let state = documentAt(0);
  for (let line = 1; line <= lastLine; line++) {
    history.checkpoint(state);
    state = documentAt(line);
  }
  return { history, state };
}

const lineOf = (state) => state.history.length - 1;

test("empty undo/redo are harmless and checkpoints copy their input", () => {
  const history = new DocumentHistory();
  const initial = documentAt(0);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);
  assert.equal(history.undo(initial), null);
  assert.equal(history.redo(initial), null);
  history.checkpoint(initial);
  initial.graph.nodes[0].label = "mutated input";
  initial.history[0].expression.probability.outcome.push("other");
  const current = documentAt(1);
  const restored = history.undo(current);
  assert.deepEqual(restored, documentAt(0));
  current.graph.nodes[0].label = "mutated current";
  assert.deepEqual(history.redo(restored), documentAt(1));
});

test("ordinary undo/redo retains graph edits and equation edits in order", () => {
  const history = new DocumentHistory();
  const states = [documentAt(0), documentAt(1), documentAt(1, "proof-a", 220), documentAt(2, "proof-a", 220)];
  states.slice(0, -1).forEach((state) => history.checkpoint(state));
  let state = states.at(-1);
  for (const expected of states.slice(0, -1).reverse()) {
    state = history.undo(state);
    assert.deepEqual(state, expected);
  }
  assert.equal(history.canUndo, false);
  for (const expected of states.slice(1)) {
    state = history.redo(state);
    assert.deepEqual(state, expected);
  }
  assert.equal(history.canRedo, false);
});

test("revert keeps graph and initial probability, returns a detached prefix, and redoes every removed line", () => {
  const { history, state } = progression(4);
  state.graph.nodes[0].x = 333;
  const before = structuredClone(state);
  let restored = history.revertTo(state, 1);
  assert.deepEqual(state, before);
  assert.deepEqual(restored.graph, state.graph);
  assert.deepEqual(restored.initial, state.initial);
  assert.deepEqual(restored.history, state.history.slice(0, 2));
  assert.deepEqual(restored.current, state.history[1].expression);
  assert.notEqual(restored.graph, state.graph);
  assert.notEqual(restored.current, restored.history[1].expression);
  for (const line of [2, 3, 4]) {
    restored = history.redo(restored);
    assert.equal(lineOf(restored), line);
    assert.equal(restored.graph.nodes[0].x, 333);
    assert.deepEqual(restored.current, restored.history.at(-1).expression);
  }
  assert.equal(history.canRedo, false);
});

test("revert prepends removed proof lines to an existing redo continuation", () => {
  const { history, state: latest } = progression(5);
  let state = history.undo(latest);
  state = history.undo(state);
  assert.equal(lineOf(state), 3);
  state = history.revertTo(state, 1);
  for (const line of [2, 3, 4, 5]) {
    state = history.redo(state);
    assert.equal(lineOf(state), line);
  }
  assert.equal(history.canRedo, false);
});

test("repeated reverts preserve one uninterrupted stepwise redo path", () => {
  const { history, state: latest } = progression(5);
  let state = history.revertTo(latest, 3);
  state = history.revertTo(state, 1);
  state = history.revertTo(state, 0);
  assert.equal(history.canUndo, false);
  for (const line of [1, 2, 3, 4, 5]) {
    state = history.redo(state);
    assert.equal(lineOf(state), line);
  }
  assert.equal(history.canRedo, false);
});

test("revert removes stale same-proof undo states including layout edits at the target", () => {
  const history = new DocumentHistory();
  const states = [documentAt(0), documentAt(1), documentAt(1, "proof-a", 200), documentAt(2, "proof-a", 200)];
  states.forEach((state) => history.checkpoint(state));
  const current = documentAt(3, "proof-a", 300);
  let state = history.revertTo(current, 1);
  assert.equal(state.graph.nodes[0].x, 300);
  state = history.undo(state);
  assert.equal(lineOf(state), 0);
  assert.equal(history.canUndo, false);
  // Undoing the reversion's prefix still retains the complete forward path.
  for (const line of [1, 2, 3]) {
    state = history.redo(state);
    assert.equal(lineOf(state), line);
    assert.equal(state.graph.nodes[0].x, 300);
  }
});

test("revert retains snapshots from earlier derivations and restart undo remains available", () => {
  const history = new DocumentHistory();
  const earlier = documentAt(4, "old-proof", 99);
  history.checkpoint(earlier);
  history.checkpoint(documentAt(0));
  history.checkpoint(documentAt(1));
  const state = history.revertTo(documentAt(2), 0);
  const previousDocument = history.undo(state);
  assert.deepEqual(previousDocument, earlier);
  assert.equal(history.canUndo, false);
  let restored = history.redo(previousDocument);
  assert.deepEqual(restored, documentAt(0));
  restored = history.redo(restored);
  assert.equal(lineOf(restored), 1);
  restored = history.redo(restored);
  assert.equal(lineOf(restored), 2);
});

test("a successful edit after reverting clears future proof lines", () => {
  const { history, state: latest } = progression(4);
  const reverted = history.revertTo(latest, 1);
  history.checkpoint(reverted);
  const branch = documentAt(2);
  branch.current.probability.observation = ["new-branch"];
  branch.history.at(-1).expression = structuredClone(branch.current);
  assert.equal(history.canRedo, false);
  assert.equal(history.redo(branch), null);
  const undone = history.undo(branch);
  assert.deepEqual(undone, reverted);
  assert.deepEqual(history.redo(undone), branch);
  assert.equal(history.canRedo, false);
});

test("graph and restart checkpoints also discard a reverted future", () => {
  for (const edit of [
    (state) => { state.graph.nodes[0].x = 400; },
    () => documentAt(0, "restarted"),
  ]) {
    const { history, state: latest } = progression(3);
    const state = history.revertTo(latest, 1);
    history.checkpoint(state);
    let changed = structuredClone(state);
    changed = edit(changed) || changed;
    assert.equal(history.canRedo, false);
    assert.deepEqual(history.undo(changed), state);
  }
});

test("invalid reversion requests leave the document and both stacks unchanged", () => {
  for (const index of [-1, 3, 4, 1.5, "1", null, undefined, NaN, Infinity]) {
    const { history, state: latest } = progression(4);
    const current = history.undo(latest);
    const before = structuredClone(current);
    assert.throws(() => history.revertTo(current, index), /earlier derivation line/);
    assert.deepEqual(current, before);
    assert.deepEqual(history.redo(current), latest);
    assert.deepEqual(history.undo(latest), current);
    assert.deepEqual(history.undo(current), documentAt(2));
  }
});

test("malformed reversion state fails before changing existing history", () => {
  const { history, state } = progression(3);
  const invalid = structuredClone(state);
  invalid.history[1].expression = null;
  assert.throws(() => history.revertTo(invalid, 0), /Every derivation line/);
  const missingId = structuredClone(state);
  delete missingId.history[0].expression.id;
  assert.throws(() => history.revertTo(missingId, 0), /initial expression ID/);
  assert.deepEqual(history.undo(state), documentAt(2));
  assert.equal(history.canRedo, true);
});

test("reversion snapshots do not share references with current or returned states", () => {
  const { history, state } = progression(3);
  const reverted = history.revertTo(state, 0);
  state.graph.nodes[0].label = "changed source";
  state.history[1].expression.probability.observation.push("changed source");
  reverted.graph.nodes[0].label = "changed return";
  reverted.history[0].expression.probability.outcome.push("changed return");
  const next = history.redo(reverted);
  assert.deepEqual(next, documentAt(1));
  next.history[0].expression.probability.outcome.push("changed replay");
  assert.deepEqual(history.redo(next), documentAt(2));
});

test("ordinary undo memory remains capped at one hundred snapshots", () => {
  const history = new DocumentHistory();
  for (let line = 0; line < 105; line++) history.checkpoint(documentAt(line));
  let state = documentAt(105);
  for (let count = 0; count < 100; count++) state = history.undo(state);
  assert.equal(lineOf(state), 5);
  assert.equal(history.canUndo, false);
  assert.equal(history.undo(state), null);
});
