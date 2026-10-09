import test from "node:test";
import assert from "node:assert/strict";
import { mSeparated, mutilate, validateGraph } from "../public/core/graph.js";
import { applyRule } from "../public/core/calculus.js";
import {
  parseProbability,
  formatProbability,
} from "../public/core/probability.js";
import {
  pathOracle,
  makeGraph,
  everyThreeNodeADMG,
  partitions,
  seededRandom,
  randomGraph,
  ruleOracleGraph,
} from "./oracle.mjs";

function checkSeparation(graph, left, right, conditioned) {
  const expected = pathOracle(graph, left, right, conditioned);
  const actual = mSeparated(graph, left, right, conditioned);
  assert.equal(
    actual,
    expected,
    JSON.stringify({ graph, left, right, conditioned, expected }),
  );
}

test("all 200 labelled three-node ADMGs: all disjoint nonempty endpoint sets and conditioning sets", (t) => {
  let graphs = 0;
  let checks = 0;
  for (const graph of everyThreeNodeADMG()) {
    graphs++;
    for (const [left, right, conditioned] of partitions(
      graph.nodes.map((n) => n.id),
      3,
    )) {
      if (!left.length || !right.length) continue;
      checkSeparation(graph, left, right, conditioned);
      checks++;
    }
  }
  assert.equal(graphs, 200);
  assert.equal(checks, 3600);
  t.diagnostic(`${graphs} graphs; ${checks} separation comparisons`);
});

test("seeded four-to-six-node ADMGs: all singleton endpoints/conditioning sets plus multivariate endpoints", (t) => {
  const random = seededRandom(0x4d534550);
  let checks = 0;
  let bows = 0;
  for (const size of [4, 5, 6])
    for (let sample = 0; sample < 100; sample++) {
      const graph = randomGraph(size, random);
      const ids = graph.nodes.map((n) => n.id);
      bows += graph.edges.filter(
        (e) =>
          e.type === "bidirected" &&
          graph.edges.some(
            (d) =>
              d.type === "directed" &&
              ((d.source === e.source && d.target === e.target) ||
                (d.source === e.target && d.target === e.source)),
          ),
      ).length;
      for (let i = 0; i < size; i++)
        for (let j = i + 1; j < size; j++) {
          const remaining = ids.filter((_, k) => k !== i && k !== j);
          for (let mask = 0; mask < 2 ** remaining.length; mask++) {
            checkSeparation(
              graph,
              [ids[i]],
              [ids[j]],
              remaining.filter((_, k) => mask & (1 << k)),
            );
            checks++;
          }
        }
      for (let k = 0; k < 32; k++) {
        const groups = [[], [], [], []];
        for (const id of ids) groups[Math.floor(random() * 4)].push(id);
        if (!groups[0].length || !groups[1].length) continue;
        checkSeparation(graph, groups[0], groups[1], groups[2]);
        checks++;
      }
    }
  assert.ok(bows > 0);
  t.diagnostic(
    `300 seeded graphs; ${checks} separation comparisons; ${bows} bows`,
  );
});

const probability = (outcome, intervention = [], observation = []) => ({
  outcome,
  intervention,
  observation,
});
const sets = (X = [], Z = ["z"], Y = ["y"], W = []) => ({ X, Z, Y, W });
const directions = {
  1: ["delete", "insert"],
  2: ["to-observation", "to-action"],
  3: ["delete", "insert"],
};
function sourceAndTarget(rule, direction, s) {
  const { X, Z, Y, W } = s;
  // Build the two displayed sides of each equality, then orient the equality.
  const sides =
    rule === 1
      ? [probability(Y, X, [...Z, ...W]), probability(Y, X, W)]
      : rule === 2
        ? [probability(Y, [...X, ...Z], W), probability(Y, X, [...Z, ...W])]
        : [probability(Y, [...X, ...Z], W), probability(Y, X, W)];
  return direction === directions[rule][0] ? sides : sides.reverse();
}
function canonical(graph, p) {
  const order = (ids) =>
    graph.nodes.map((n) => n.id).filter((id) => ids.includes(id));
  return {
    outcome: order(p.outcome),
    intervention: order(p.intervention),
    observation: order(p.observation),
  };
}
function compareRule(graph, rule, direction, s) {
  const [before, after] = sourceAndTarget(rule, direction, s);
  const expected = ruleOracleGraph(graph, rule, s);
  const valid = pathOracle(expected.graph, s.Y, s.Z, [...s.X, ...s.W]);
  if (!valid) {
    assert.throws(
      () => applyRule(graph, before, rule, direction, s),
      /not m-separated/,
      JSON.stringify({ graph, rule, direction, s }),
    );
    return;
  }
  const result = applyRule(graph, before, rule, direction, s);
  assert.deepEqual(result.probability, canonical(graph, after));
  assert.deepEqual(result.certificate.zW, expected.zW);
  assert.deepEqual(
    result.certificate.removedEdges,
    graph.edges
      .filter((e) => !expected.graph.edges.includes(e))
      .map((e) => e.id),
  );
}

test("all three-node ADMGs: every disjoint rule assignment, all rules, both directions", (t) => {
  let checks = 0;
  for (const graph of everyThreeNodeADMG()) {
    for (const [X, Z, Y, W] of partitions(
      graph.nodes.map((n) => n.id),
      4,
    )) {
      if (!Y.length || !Z.length) continue;
      for (const rule of [1, 2, 3])
        for (const direction of directions[rule]) {
          compareRule(graph, rule, direction, { X, Z, Y, W });
          checks++;
        }
    }
  }
  assert.equal(checks, 28800);
  t.diagnostic(`${checks} oracle comparisons of complete rule applications`);
});

test("seeded four-to-six-node ADMGs: random disjoint rule assignments and both directions", (t) => {
  const random = seededRandom(0x444f4341);
  let checks = 0;
  for (const size of [4, 5, 6])
    for (let sample = 0; sample < 80; sample++) {
      const graph = randomGraph(size, random);
      for (let assignment = 0; assignment < 24; assignment++) {
        const groups = [[], [], [], [], []];
        for (const { id } of graph.nodes)
          groups[Math.floor(random() * 5)].push(id);
        const [X, Z, Y, W] = groups;
        if (!Y.length || !Z.length) continue;
        for (const rule of [1, 2, 3])
          for (const direction of directions[rule]) {
            compareRule(graph, rule, direction, { X, Z, Y, W });
            checks++;
          }
      }
    }
  t.diagnostic(`240 seeded graphs; ${checks} rule comparisons`);
});

test("Rule 2 cuts outgoing directed edges, Rule 3 cuts incoming bidirected edges", () => {
  const directed = makeGraph(["z", "y"], [["z", "y"]]);
  const confounded = makeGraph(["z", "y"], [], [["z", "y"]]);
  const p = probability(["y"], ["z"]);
  assert.deepEqual(
    applyRule(directed, p, 2, "to-observation", sets()).probability,
    probability(["y"], [], ["z"]),
  );
  assert.throws(
    () => applyRule(directed, p, 3, "delete", sets()),
    /not m-separated/,
  );
  assert.throws(
    () => applyRule(confounded, p, 2, "to-observation", sets()),
    /not m-separated/,
  );
  assert.deepEqual(
    applyRule(confounded, p, 3, "delete", sets()).probability,
    probability(["y"]),
  );
});

test("Rule 3 retains incoming edges to Z when Z is an ancestor of W", () => {
  const graph = makeGraph(["z", "y", "w"], [["z", "w"]], [["y", "z"]]);
  assert.throws(
    () =>
      applyRule(
        graph,
        probability(["y"], ["z"], ["w"]),
        3,
        "delete",
        sets([], ["z"], ["y"], ["w"]),
      ),
    /not m-separated/,
  );
});

test("Rule 3 computes Z(W) in G_barX, not the original graph", () => {
  const graph = makeGraph(
    ["z", "x", "y", "w"],
    [
      ["z", "x"],
      ["x", "w"],
    ],
    [["y", "z"]],
  );
  const result = applyRule(
    graph,
    probability(["y"], ["x", "z"], ["w"]),
    3,
    "delete",
    sets(["x"], ["z"], ["y"], ["w"]),
  );
  assert.deepEqual(result.probability, probability(["y"], ["x"], ["w"]));
  assert.deepEqual(result.certificate.zW, ["z"]);
});

test("Rule 3 Z(W) distinguishes individual members of a multivariate Z", () => {
  const graph = makeGraph(["z1", "z2", "y", "w"], [["z1", "w"]], [["z2", "y"]]);
  const result = applyRule(
    graph,
    probability(["y"], ["z1", "z2"], ["w"]),
    3,
    "delete",
    sets([], ["z1", "z2"], ["y"], ["w"]),
  );
  assert.deepEqual(result.probability, probability(["y"], [], ["w"]));
  assert.deepEqual(result.certificate.zW, ["z2"]);
});

test("Rule 1 incoming cut removes bidirected edges and recomputes collider ancestry", () => {
  const confoundedCollider = makeGraph(
    ["z", "x", "y"],
    [["z", "x"]],
    [["x", "y"]],
  );
  const descendant = makeGraph(
    ["z", "x", "y", "k"],
    [
      ["z", "k"],
      ["y", "k"],
      ["k", "x"],
    ],
  );
  for (const graph of [confoundedCollider, descendant]) {
    assert.deepEqual(
      applyRule(
        graph,
        probability(["y"], ["x"], ["z"]),
        1,
        "delete",
        sets(["x"]),
      ).probability,
      probability(["y"], ["x"]),
    );
  }
});

test("colliders are opened by conditioning on themselves or directed descendants", () => {
  const descendant = makeGraph(
    ["z", "y", "k", "w"],
    [
      ["z", "k"],
      ["y", "k"],
      ["k", "w"],
    ],
  );
  const bidirected = makeGraph(
    ["z", "y", "k"],
    [],
    [
      ["z", "k"],
      ["k", "y"],
    ],
  );
  assert.equal(mSeparated(descendant, ["z"], ["y"], []), true);
  assert.equal(mSeparated(descendant, ["z"], ["y"], ["w"]), false);
  assert.equal(mSeparated(bidirected, ["z"], ["y"], []), true);
  assert.equal(mSeparated(bidirected, ["z"], ["y"], ["k"]), false);
});

test("exact matching rejects omitted actions, observations, and outcomes in every direction", () => {
  const graph = makeGraph(["x", "z", "y", "w", "extra"]);
  const s = sets(["x"], ["z"], ["y"], ["w"]);
  for (const rule of [1, 2, 3])
    for (const direction of directions[rule]) {
      const [before] = sourceAndTarget(rule, direction, s);
      for (const field of ["intervention", "observation"]) {
        assert.throws(
          () =>
            applyRule(
              graph,
              { ...before, [field]: [...before[field], "extra"] },
              rule,
              direction,
              s,
            ),
          /do not match/,
        );
      }
      assert.throws(
        () =>
          applyRule(
            graph,
            { ...before, outcome: ["y", "extra"] },
            rule,
            direction,
            s,
          ),
        /exactly the outcomes/,
      );
      assert.throws(
        () => applyRule(graph, before, rule, direction, { ...s, X: [] }),
        /do not match/,
      );
      assert.throws(
        () => applyRule(graph, before, rule, direction, { ...s, W: [] }),
        /do not match/,
      );
      const result = applyRule(graph, before, rule, direction, s);
      assert.deepEqual(
        result.probability,
        canonical(graph, sourceAndTarget(rule, direction, s)[1]),
      );
    }
});

test("disjointness, membership, nonempty Y/Z, and rule direction validation", () => {
  const graph = makeGraph(["x", "z", "y", "w"]);
  const p = probability(["y"], ["x"], ["z", "w"]);
  const s = sets(["x"], ["z"], ["y"], ["w"]);
  assert.throws(
    () => applyRule(graph, p, 1, "delete", { ...s, X: ["x", "z"] }),
    /pairwise disjoint/,
  );
  assert.throws(
    () => applyRule(graph, p, 1, "delete", { ...s, Z: ["z", "z"] }),
    /pairwise disjoint/,
  );
  assert.throws(
    () => applyRule(graph, p, 1, "delete", { ...s, Z: ["unknown"] }),
    /not in this graph/,
  );
  assert.throws(
    () => applyRule(graph, p, 1, "delete", { ...s, Z: [] }),
    /at least one/,
  );
  assert.throws(
    () => applyRule(graph, p, 1, "delete", { ...s, Y: [] }),
    /at least one/,
  );
  assert.throws(() => applyRule(graph, p, 4, "delete", s), /Unknown rule/);
  assert.throws(() => applyRule(graph, p, 1, "to-action", s), /Unknown rule/);
});

test("non-numeric rule values cannot be misinterpreted as a different numeric rule", () => {
  const graph = makeGraph(["z", "y"]);
  // This is a valid Rule 3 insertion but not a Rule 1 insertion result.
  // Accepting string "1" in the lookup and then falling into the Rule 3 branch is unsound API behavior.
  for (const rule of ["1", "2", "3", null, undefined]) {
    assert.throws(
      () => applyRule(graph, probability(["y"]), rule, "insert", sets()),
      /Unknown rule/,
    );
  }
});

test("graph validation allows bows and bidirected cycles but rejects directed cycles and duplicate edges", () => {
  const bow = makeGraph(["a", "b"], [["a", "b"]], [["a", "b"]]);
  const bidirectedCycle = makeGraph(
    ["a", "b", "c"],
    [],
    [
      ["a", "b"],
      ["b", "c"],
      ["a", "c"],
    ],
  );
  assert.doesNotThrow(() => validateGraph(bow));
  assert.doesNotThrow(() => validateGraph(bidirectedCycle));
  assert.throws(
    () =>
      validateGraph(
        makeGraph(
          ["a", "b", "c"],
          [
            ["a", "b"],
            ["b", "c"],
            ["c", "a"],
          ],
        ),
      ),
    /directed cycle/,
  );
  assert.throws(
    () =>
      validateGraph(
        makeGraph(
          ["a", "b"],
          [],
          [
            ["a", "b"],
            ["b", "a"],
          ],
        ),
      ),
    /already exists/,
  );
  assert.throws(() => validateGraph(makeGraph(["a"], [["a", "a"]])), /itself/);
  assert.throws(
    () => validateGraph(makeGraph(["a"], [["a", "b"]])),
    /existing nodes/,
  );
  assert.deepEqual(
    mutilate(bow, [], ["a"]).edges.map((e) => e.type),
    ["bidirected"],
  );
  assert.equal(mutilate(bow, ["b"]).edges.length, 0);
});

test("rule applications are non-mutating and certificates do not alias selected sets", () => {
  const graph = makeGraph(["x", "z", "y", "w"]);
  const p = probability(["y"], ["x"], ["z", "w"]);
  const s = sets(["x"], ["z"], ["y"], ["w"]);
  const snapshot = structuredClone({ graph, p, s });
  const result = applyRule(graph, p, 1, "delete", s);
  assert.deepEqual({ graph, p, s }, snapshot);
  result.certificate.sets.X.push("mutated");
  assert.deepEqual(s.X, ["x"]);
});

test("stored rule certificates remain unchanged if their original input selections are edited later", () => {
  const graph = makeGraph(["x", "z", "y", "w"]);
  const s = sets(["x"], ["z"], ["y"], ["w"]);
  const result = applyRule(
    graph,
    probability(["y"], ["x", "z"], ["w"]),
    2,
    "to-observation",
    s,
  );
  const snapshot = structuredClone(result);
  s.Z.length = 0;
  s.X.push("changed");
  s.W.length = 0;
  assert.deepEqual(result, snapshot);
});

test("probability grammar preserves Unicode identifiers and rejects unsupported or overlapping expressions", () => {
  const p = probability(["Y", "β"], ["X", "Z"], ["W", "age"]);
  assert.deepEqual(parseProbability(" P( Y, β | do(X), do(Z), W, age ) "), p);
  assert.deepEqual(parseProbability(formatProbability(p)), p);
  assert.deepEqual(parseProbability("P(y)"), probability(["y"]));
  assert.deepEqual(
    parseProbability("P(do | x)"),
    probability(["do"], [], ["x"]),
  );
  for (const text of [
    "P()",
    "P(y |)",
    "P(y|do())",
    "P(y,y)",
    "P(y|do(y))",
    "P(y|z,z)",
    "P(y|do(x),x)",
    "P(y|x,)",
    "P(y)P(x)",
    "P(y)=P(x)",
    "P(y)+P(x)",
    "P(y);alert(1)",
    "P(y|Do(x))",
    "P(y|do(x,) )",
    "P(y|do(do(x)))",
  ]) {
    assert.throws(() => parseProbability(text), undefined, text);
  }
});
