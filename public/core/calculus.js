import { ancestors, mSeparated, mutilate, validateGraph } from "./graph.js";
import { validateProbability } from "./probability.js";

export const RULES = {
  1: {
    title: "Insert / delete observation",
    directions: [
      ["delete", "Delete observation"],
      ["insert", "Insert observation"],
    ],
  },
  2: {
    title: "Exchange action / observation",
    directions: [
      ["to-observation", "Action → observation"],
      ["to-action", "Observation → action"],
    ],
  },
  3: {
    title: "Insert / delete action",
    directions: [
      ["delete", "Delete action"],
      ["insert", "Insert action"],
    ],
  },
};
const same = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

/** A rule is a checked rewrite of the entire single probability, in either direction.
 * No hidden leftover variables or inferred memberships are permitted.
 * Source: Pearl, The Do-Calculus Revisited (2012), §1.2, equations (3)–(5).
 */
export function applyRule(graph, probability, rule, direction, sets) {
  validateGraph(graph);
  validateProbability(probability, graph);
  if (
    !Number.isInteger(rule) ||
    !RULES[rule]?.directions.some(([value]) => value === direction)
  )
    throw new Error("Unknown rule or direction.");
  const { X, Z, Y, W } = sets;
  const known = new Set(graph.nodes.map((node) => node.id));
  const selected = [X, Z, Y, W].flat();
  if (selected.some((id) => !known.has(id)))
    throw new Error("A selected node is not in this graph.");
  if (new Set(selected).size !== selected.length)
    throw new Error(
      "X, Z, Y, and W must be pairwise disjoint, without duplicates.",
    );
  if (!Y.length || !Z.length)
    throw new Error("Select at least one node in Y and in Z.");
  if (!same(probability.outcome, Y))
    throw new Error(
      "Y must contain exactly the outcomes in the current probability.",
    );

  let beforeActions, beforeObservations, afterActions, afterObservations;
  if (rule === 1) {
    beforeActions = afterActions = X;
    beforeObservations = direction === "delete" ? [...Z, ...W] : W;
    afterObservations = direction === "delete" ? W : [...Z, ...W];
  } else if (rule === 2) {
    const toObservation = direction === "to-observation";
    beforeActions = toObservation ? [...X, ...Z] : X;
    beforeObservations = toObservation ? W : [...Z, ...W];
    afterActions = toObservation ? X : [...X, ...Z];
    afterObservations = toObservation ? [...Z, ...W] : W;
  } else {
    beforeActions = direction === "delete" ? [...X, ...Z] : X;
    afterActions = direction === "delete" ? X : [...X, ...Z];
    beforeObservations = afterObservations = W;
  }
  if (
    !same(probability.intervention, beforeActions) ||
    !same(probability.observation, beforeObservations)
  ) {
    throw new Error(
      "The selected sets do not match the current probability in this direction. Account for every action and observation using X, Z, and W.",
    );
  }
  const withoutX = mutilate(graph, X);
  const wAncestors = ancestors(withoutX, W);
  const zW = rule === 3 ? Z.filter((id) => !wAncestors.has(id)) : [];
  const incoming = [...X, ...zW];
  const outgoing = rule === 2 ? [...Z] : [];
  const checkedGraph = mutilate(graph, incoming, outgoing);
  const conditioned = [...X, ...W];
  if (!mSeparated(checkedGraph, Y, Z, conditioned)) {
    throw new Error(
      "Rule blocked: Y and Z are not m-separated given X ∪ W in the required modified graph. The probability has not changed.",
    );
  }
  // Canonical graph order keeps equivalent sets displayed consistently.
  const order = (ids) =>
    graph.nodes.map((node) => node.id).filter((id) => ids.includes(id));
  return {
    probability: {
      outcome: order(Y),
      intervention: order(afterActions),
      observation: order(afterObservations),
    },
    certificate: {
      rule,
      direction,
      sets: structuredClone(sets),
      incoming,
      outgoing,
      zW,
      conditioned,
      removedEdges: graph.edges
        .filter(
          (edge) => !checkedGraph.edges.some((kept) => kept.id === edge.id),
        )
        .map((edge) => edge.id),
    },
  };
}
