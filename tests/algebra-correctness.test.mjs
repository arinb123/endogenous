import test from "node:test";
import assert from "node:assert/strict";
import {
  probabilityExpression,
  productExpression,
  sumExpression,
  validateExpression,
  freeVariables,
  formatExpression,
} from "../public/core/expression.js";
import {
  applyMarginalization,
  applyChainRule,
  applyDoCalculus,
} from "../public/core/algebra.js";
import {
  assignments,
  finiteModel,
  frontDoorModel,
  randomGenerator,
  shuffled,
  scopeFreeVariables,
  allNodes,
  deepFreeze,
} from "./numerical-oracle.mjs";

const cardinality = { a: 2, b: 3, c: 2, d: 2, e: 2 };
const variables = Object.keys(cardinality);
const graph = { nodes: variables.map((id) => ({ id, label: id })), edges: [] };
const P = (outcome, intervention = [], observation = [], id) =>
  probabilityExpression({ outcome, intervention, observation }, id);
const marginalize = (...args) => applyMarginalization(graph, ...args);
const chain = (...args) => applyChainRule(graph, ...args);

let numericComparisons = 0;
function equivalent(before, after, model = finiteModel(cardinality, 719)) {
  const free = [
    ...new Set([...scopeFreeVariables(before), ...scopeFreeVariables(after)]),
  ];
  for (const environment of assignments(free, cardinality)) {
    const left = model.evaluate(before, environment);
    const right = model.evaluate(after, environment);
    assert.ok(
      Math.abs(left - right) <=
        1e-12 * Math.max(1, Math.abs(left), Math.abs(right)),
      JSON.stringify({ before, after, environment, left, right }),
    );
    numericComparisons++;
  }
}
function selectionPresent(result) {
  const nodes = allNodes(result.expression);
  assert.ok(result.selection.length > 0);
  assert.ok(
    result.selection.every((id) => nodes.some((node) => node.id === id)),
  );
}

test("positive finite kernels: multivariate marginalization expands and collapses under each intervention assignment", (t) => {
  const random = randomGenerator(0x53554d53);
  const beforeCount = numericComparisons;
  for (let sample = 0; sample < 240; sample++) {
    const groups = [[], [], [], [], []];
    // Guarantee nonempty outcomes and marginalization variables, then randomly place the remaining nodes.
    const order = shuffled(variables, random);
    groups[0].push(order[0]);
    groups[1].push(order[1]);
    for (const id of order.slice(2)) groups[Math.floor(random() * 5)].push(id);
    const [Y, Z, A, B] = groups;
    const root = P(Y, A, B);
    const snapshot = structuredClone(root);
    const expanded = marginalize(root, [root.id], "expand", Z);
    const collapsed = marginalize(
      expanded.expression,
      expanded.selection,
      "collapse",
      [...Z].reverse(),
    );
    const model = finiteModel(cardinality, sample + 31);
    equivalent(root, expanded.expression, model);
    equivalent(root, collapsed.expression, model);
    assert.deepEqual(root, snapshot);
    assert.deepEqual(collapsed.expression.probability, root.probability);
    assert.deepEqual(
      new Set(freeVariables(expanded.expression)),
      scopeFreeVariables(root),
    );
    selectionPresent(expanded);
    selectionPresent(collapsed);
  }
  t.diagnostic(
    `${numericComparisons - beforeCount} numerical comparisons over 240 positive kernel families`,
  );
});

test("positive finite kernels: chain rule round trips with either physical factor order and either selection order", (t) => {
  const random = randomGenerator(0x43484149);
  const beforeCount = numericComparisons;
  for (let sample = 0; sample < 240; sample++) {
    const groups = [[], [], [], [], []];
    const order = shuffled(variables, random);
    groups[0].push(order[0]);
    groups[1].push(order[1]);
    for (const id of order.slice(2)) groups[Math.floor(random() * 5)].push(id);
    const [Y, Z, A, B] = groups;
    const root = P([...Y, ...Z], A, B);
    const split = chain(root, [root.id], "split", Y, Z);
    const model = finiteModel(cardinality, sample + 500);
    equivalent(root, split.expression, model);
    for (const factors of [
      split.expression.factors,
      [...split.expression.factors].reverse(),
    ]) {
      const product = productExpression(factors);
      for (const selected of [
        [product.id],
        factors.map((f) => f.id),
        factors.map((f) => f.id).reverse(),
      ]) {
        const combined = chain(
          product,
          selected,
          "combine",
          [...Y].reverse(),
          [...Z].reverse(),
        );
        equivalent(root, combined.expression, model);
        selectionPresent(combined);
      }
    }
  }
  t.diagnostic(
    `${numericComparisons - beforeCount} numerical comparisons over 240 positive kernel families`,
  );
});

test("local marginalization does not capture a free sibling variable or expand across its product", () => {
  const sibling = P(["b"]);
  const selected = P(["a"], ["c"], ["d"]);
  const outerWeight = P(["e"]);
  const root = sumExpression(
    ["e"],
    productExpression([sibling, selected, outerWeight]),
  );
  const expanded = marginalize(root, [selected.id], "expand", ["b"]);
  assert.equal(expanded.expression.type, "sum");
  assert.deepEqual(expanded.expression.variables, ["e"]);
  assert.deepEqual(expanded.expression.body.factors[0], sibling);
  assert.deepEqual(expanded.expression.body.factors[2], outerWeight);
  assert.equal(expanded.expression.body.factors[1].type, "sum");
  assert.deepEqual(expanded.expression.body.factors[1].variables, ["b"]);
  assert.ok(
    freeVariables(expanded.expression).has("b"),
    "the sibling b remains free",
  );
  equivalent(root, expanded.expression);
  const collapsed = marginalize(
    expanded.expression,
    expanded.selection,
    "collapse",
    ["b"],
  );
  assert.deepEqual(collapsed.expression, root);
});

test("chain operations on selected factors inside a sum preserve n-ary siblings and their order", () => {
  const first = P(["e"]);
  const joint = P(["a", "b"], ["c"], ["d"]);
  const last = P(["d"]);
  const root = sumExpression(["e"], productExpression([first, joint, last]));
  const split = chain(root, [joint.id], "split", ["a"], ["b"]);
  assert.equal(split.expression.body.factors.length, 4);
  assert.deepEqual(split.expression.body.factors[0], first);
  assert.deepEqual(split.expression.body.factors[3], last);
  assert.equal(
    split.selection.length,
    2,
    "flattening replaces the old selected probability with a selectable pair",
  );
  equivalent(root, split.expression);
  const combined = chain(
    split.expression,
    [...split.selection].reverse(),
    "combine",
    ["a"],
    ["b"],
  );
  assert.equal(combined.expression.body.factors.length, 3);
  assert.deepEqual(combined.expression.body.factors[0], first);
  assert.deepEqual(combined.expression.body.factors[2], last);
  equivalent(root, combined.expression);
});

test("nonadjacent sibling factors combine locally in either physical order", () => {
  for (const reverse of [false, true]) {
    const conditional = P(["a"], ["c"], ["b", "d"]);
    const marginal = P(["b"], ["c"], ["d"]);
    const sibling = P(["e"]);
    const pair = reverse ? [marginal, conditional] : [conditional, marginal];
    const root = productExpression([pair[0], sibling, pair[1]]);
    const combined = chain(
      root,
      [pair[1].id, pair[0].id],
      "combine",
      ["a"],
      ["b"],
    );
    assert.equal(combined.expression.factors.length, 2);
    assert.deepEqual(combined.expression.factors[1], sibling);
    equivalent(root, combined.expression);
    selectionPresent(combined);
  }
});

test("multivariate sum collapse requires its full binder set and keeps all remaining outcomes", () => {
  const root = sumExpression(["b", "e"], P(["a", "b", "e"], ["c"], ["d"]));
  const collapsed = marginalize(root, [root.id], "collapse", ["e", "b"]);
  assert.deepEqual(collapsed.expression.probability, {
    outcome: ["a"],
    intervention: ["c"],
    observation: ["d"],
  });
  equivalent(root, collapsed.expression);
  assert.throws(
    () => marginalize(root, [root.id], "collapse", ["b"]),
    /exactly/,
  );
});

test("nested distinct sums collapse inside out without flattening their scopes", () => {
  const inner = sumExpression(["b"], P(["a", "b", "e"], ["c"], ["d"]));
  const root = sumExpression(["e"], inner);
  const innerCollapse = marginalize(root, [inner.id], "collapse", ["b"]);
  assert.equal(innerCollapse.expression.type, "sum");
  assert.deepEqual(innerCollapse.expression.variables, ["e"]);
  equivalent(root, innerCollapse.expression);
  const allCollapse = marginalize(
    innerCollapse.expression,
    [root.id],
    "collapse",
    ["e"],
  );
  equivalent(root, allCollapse.expression);
});

test("marginalization rejects occupied variables, ancestor rebinding, empty sums, and invalid collapse shapes", () => {
  const p = P(["a"], ["c"], ["d"]);
  for (const Z of [["a"], ["c"], ["d"]])
    assert.throws(() => marginalize(p, [p.id], "expand", Z), /absent/);
  for (const Z of [[], ["b", "b"], ["missing"]])
    assert.throws(() => marginalize(p, [p.id], "expand", Z));
  const nested = sumExpression(["b"], p);
  assert.throws(
    () => marginalize(nested, [p.id], "expand", ["b"]),
    /already summed/,
  );
  assert.throws(() => marginalize(p, [p.id], "collapse", ["b"]), /whole sum/);
  for (const body of [P(["a"], [], ["b"]), P(["a"], ["b"]), P(["a"])]) {
    const root = sumExpression(["b"], body);
    assert.throws(
      () => marginalize(root, [root.id], "collapse", ["b"]),
      /Every summed variable/,
    );
  }
  const normalized = sumExpression(["b"], P(["b"]));
  assert.throws(
    () => marginalize(normalized, [normalized.id], "collapse", ["b"]),
    /at least one outcome/,
  );
  const factors = sumExpression(
    ["b"],
    productExpression([P(["a"], [], ["b"]), P(["b"])]),
  );
  assert.throws(
    () => marginalize(factors, [factors.id], "collapse", ["b"]),
    /one joint probability/,
  );
});

test("chain rule rejects incomplete partitions and reverse context mismatches", () => {
  const root = P(["a", "b", "e"], ["c"], ["d"]);
  assert.throws(
    () => chain(root, [root.id], "split", ["a"], ["b"]),
    /partition all/,
  );
  assert.throws(
    () => chain(root, [root.id], "split", ["a"], ["a", "b", "e"]),
    /disjoint/,
  );
  assert.throws(
    () => chain(root, [root.id], "split", [], ["a", "b", "e"]),
    /at least one/,
  );
  assert.throws(
    () => chain(root, [root.id], "split", ["a", "a"], ["b", "e"]),
    /duplicates/,
  );
  const cases = [
    [P(["a"], ["c"], ["b", "d", "e"]), P(["b"], ["c"], ["d"])],
    [P(["a"], ["c"], ["b", "d"]), P(["b"], [], ["d"])],
    [P(["a"], ["c"], ["b", "d"]), P(["b"], ["c"], ["e"])],
    [P(["a"], ["c"], ["d"]), P(["b"], ["c"], ["d"])],
  ];
  for (const factors of cases) {
    const product = productExpression(factors);
    assert.throws(
      () => chain(product, [product.id], "combine", ["a"], ["b"]),
      /exactly/,
    );
  }
  const proper = productExpression([
    P(["a"], ["c"], ["b", "d"]),
    P(["b"], ["c"], ["d"]),
  ]);
  assert.throws(
    () => chain(proper, [proper.id], "combine", ["e"], ["b"]),
    /outcome sets/,
  );
});

test("chain combination never crosses a summation boundary or implicitly selects all n-ary factors", () => {
  const conditional = P(["a"], [], ["b"]);
  const marginal = P(["b"]);
  const sum = sumExpression(["b"], marginal);
  const root = productExpression([conditional, sum]);
  assert.throws(
    () => chain(root, [conditional.id, marginal.id], "combine", ["a"], ["b"]),
    /same product/,
  );
  assert.throws(
    () => chain(root, [root.id], "combine", ["a"], ["b"]),
    /individual probability/,
  );
  const nary = productExpression([conditional, marginal, P(["e"])]);
  assert.throws(
    () => chain(nary, [nary.id], "combine", ["a"], ["b"]),
    /exactly two/,
  );
  assert.throws(
    () =>
      chain(nary, [conditional.id, conditional.id], "combine", ["a"], ["b"]),
    /exactly two/,
  );
});

test("do-calculus applies pointwise to factors in sums, including insertion of ancestor-bound observations and actions", () => {
  const model = finiteModel(cardinality, 151, true);
  const weight = P(["b"]);
  const selected = P(["a"]);
  const original = sumExpression(["b"], productExpression([weight, selected]));
  const sets = { X: [], Z: ["b"], Y: ["a"], W: [] };
  const observation = applyDoCalculus(
    graph,
    original,
    [selected.id],
    1,
    "insert",
    sets,
  );
  equivalent(original, observation.expression, model);
  assert.deepEqual(observation.expression.body.factors[0], weight);
  assert.deepEqual(
    observation.expression.body.factors[1].probability.observation,
    ["b"],
  );
  const action = applyDoCalculus(
    graph,
    observation.expression,
    [selected.id],
    2,
    "to-action",
    sets,
  );
  equivalent(original, action.expression, model);
  assert.deepEqual(action.expression.body.factors[1].probability.intervention, [
    "b",
  ]);
  const removed = applyDoCalculus(
    graph,
    action.expression,
    [selected.id],
    3,
    "delete",
    sets,
  );
  assert.deepEqual(removed.expression, original);
  const directAction = applyDoCalculus(
    graph,
    original,
    [selected.id],
    3,
    "insert",
    sets,
  );
  equivalent(original, directAction.expression, model);
  selectionPresent(observation);
  selectionPresent(action);
  selectionPresent(removed);
});

test("do-calculus rejection within a sum leaves the full expression unchanged", () => {
  const dependentGraph = {
    ...graph,
    edges: [{ id: "edge", type: "directed", source: "a", target: "b" }],
  };
  const selected = P(["a"]);
  const root = deepFreeze(
    sumExpression(["b"], productExpression([P(["b"]), selected])),
  );
  const snapshot = structuredClone(root);
  assert.throws(
    () =>
      applyDoCalculus(dependentGraph, root, [selected.id], 1, "insert", {
        X: [],
        Z: ["b"],
        Y: ["a"],
        W: [],
      }),
    /not m-separated/,
  );
  assert.deepEqual(root, snapshot);
});

test("operations accept deeply frozen inputs; output edits do not mutate inputs or certificates", () => {
  const root = deepFreeze(P(["a"], ["c"], ["d"]));
  const Z = deepFreeze(["b"]);
  const expanded = marginalize(root, [root.id], "expand", Z);
  const before = structuredClone(root);
  expanded.expression.body.probability.intervention.push("e");
  expanded.certificate.sets.Z.push("e");
  assert.deepEqual(root, before);
  assert.deepEqual(Z, ["b"]);
  const joint = deepFreeze(P(["a", "b"], ["c"], ["d"]));
  const split = chain(joint, [joint.id], "split", deepFreeze(["a"]), Z);
  const splitSnapshot = structuredClone(split.expression);
  const combined = chain(
    deepFreeze(split.expression),
    split.selection,
    "combine",
    ["a"],
    ["b"],
  );
  combined.expression.probability.intervention.push("e");
  assert.deepEqual(split.expression, splitSnapshot);
});

test("expression scope, unique IDs, unknown nodes, and stale selections are checked", () => {
  const leaf = P(["a"]);
  const duplicate = {
    type: "product",
    id: "test-product",
    factors: [leaf, structuredClone(leaf)],
  };
  assert.throws(() => validateExpression(duplicate, graph), /unique/);
  assert.throws(
    () =>
      validateExpression(
        sumExpression(["b"], sumExpression(["b"], leaf)),
        graph,
      ),
    /distinct variables/,
  );
  assert.throws(
    () => validateExpression(sumExpression(["missing"], leaf), graph),
    /not in this graph/,
  );
  assert.throws(
    () => marginalize(leaf, ["stale"], "expand", ["b"]),
    /no longer/,
  );
  assert.throws(() => marginalize(leaf, [], "expand", ["b"]), /Select one/);
  assert.throws(
    () => chain(leaf, [leaf.id], "unknown", ["a"], ["b"]),
    /Unknown/,
  );
  assert.throws(
    () => marginalize(leaf, [leaf.id], "unknown", ["b"]),
    /Unknown/,
  );
  const freeSibling = P(["b"]);
  const scoped = productExpression([
    freeSibling,
    sumExpression(["b"], P(["a", "b"])),
  ]);
  assert.deepEqual(freeVariables(scoped), scopeFreeVariables(scoped));
  assert.match(formatExpression(scoped), /Σ_\{b\} \[/);
});

test("a constant integrand retains summation multiplicity, and an unweighted conditional sum is not a marginal", () => {
  const model = finiteModel(cardinality, 151, true);
  const p = P(["a"]);
  const sum = sumExpression(["b"], p);
  for (const environment of assignments(["a"], cardinality)) {
    assert.ok(
      Math.abs(
        model.evaluate(sum, environment) - 3 * model.evaluate(p, environment),
      ) < 1e-12,
    );
  }
  assert.throws(
    () => marginalize(sum, [sum.id], "collapse", ["b"]),
    /Every summed variable/,
  );
  const conditional = sumExpression(["b"], P(["a"], [], ["b"]));
  const correlated = finiteModel(cardinality, 972);
  for (const environment of assignments(["a"], cardinality)) {
    assert.ok(
      correlated.evaluate(conditional, environment) >
        correlated.evaluate(p, environment),
    );
  }
  assert.throws(
    () => marginalize(conditional, [conditional.id], "collapse", ["b"]),
    /Every summed variable/,
  );
});

test("integrated front-door derivation preserves every step numerically, with a locally bound treatment and free treatment sibling", () => {
  const frontGraph = {
    ...graph,
    edges: [
      { id: "treatment-mediator", type: "directed", source: "c", target: "b" },
      { id: "mediator-outcome", type: "directed", source: "b", target: "a" },
      { id: "confounding", type: "bidirected", source: "c", target: "a" },
    ],
  };
  const initial = P(["a"], ["c"]);
  const model = frontDoorModel(cardinality);
  let current = initial;
  const equalSets = (a, b) =>
    [...a].sort().join(",") === [...b].sort().join(",");
  function factor(outcome, intervention, observation) {
    const found = allNodes(current).filter(
      (node) =>
        node.type === "probability" &&
        equalSets(node.probability.outcome, outcome) &&
        equalSets(node.probability.intervention, intervention) &&
        equalSets(node.probability.observation, observation),
    );
    assert.equal(found.length, 1);
    return found[0].id;
  }
  function accept(result) {
    equivalent(initial, result.expression, model);
    selectionPresent(result);
    current = result.expression;
  }
  accept(
    applyMarginalization(frontGraph, current, [current.id], "expand", ["b"]),
  );
  accept(
    applyChainRule(
      frontGraph,
      current,
      [factor(["a", "b"], ["c"], [])],
      "split",
      ["a"],
      ["b"],
    ),
  );
  accept(
    applyDoCalculus(
      frontGraph,
      current,
      [factor(["b"], ["c"], [])],
      2,
      "to-observation",
      { X: [], Z: ["c"], Y: ["b"], W: [] },
    ),
  );
  accept(
    applyDoCalculus(
      frontGraph,
      current,
      [factor(["a"], ["c"], ["b"])],
      2,
      "to-action",
      { X: ["c"], Z: ["b"], Y: ["a"], W: [] },
    ),
  );
  accept(
    applyDoCalculus(
      frontGraph,
      current,
      [factor(["a"], ["b", "c"], [])],
      3,
      "delete",
      { X: ["b"], Z: ["c"], Y: ["a"], W: [] },
    ),
  );
  accept(
    applyMarginalization(
      frontGraph,
      current,
      [factor(["a"], ["b"], [])],
      "expand",
      ["c"],
    ),
  );
  accept(
    applyChainRule(
      frontGraph,
      current,
      [factor(["a", "c"], ["b"], [])],
      "split",
      ["a"],
      ["c"],
    ),
  );
  accept(
    applyDoCalculus(
      frontGraph,
      current,
      [factor(["a"], ["b"], ["c"])],
      2,
      "to-observation",
      { X: [], Z: ["b"], Y: ["a"], W: ["c"] },
    ),
  );
  accept(
    applyDoCalculus(
      frontGraph,
      current,
      [factor(["c"], ["b"], [])],
      3,
      "delete",
      { X: [], Z: ["b"], Y: ["c"], W: [] },
    ),
  );
  assert.ok(
    allNodes(current)
      .filter((node) => node.type === "probability")
      .every((node) => node.probability.intervention.length === 0),
  );
  assert.deepEqual(freeVariables(current), new Set(["a", "c"]));
  assert.equal(current.type, "sum");
  assert.deepEqual(current.variables, ["b"]);
  assert.equal(current.body.factors[0].type, "sum");
  assert.deepEqual(current.body.factors[0].variables, ["c"]);
  assert.deepEqual(current.body.factors[1].probability, {
    outcome: ["b"],
    intervention: [],
    observation: ["c"],
  });
});
