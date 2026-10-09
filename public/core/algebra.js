import { applyRule } from "./calculus.js";
import {
  locateExpression,
  probabilityExpression,
  productExpression,
  sumExpression,
  replaceExpression,
  sameSet,
  validateExpression,
  validateVariables,
} from "./expression.js";

export const ALGEBRA = {
  marginalize: {
    title: "Marginalize",
    sets: ["Z"],
    directions: [
      ["expand", "Introduce sum"],
      ["collapse", "Collapse sum"],
    ],
    equation: "P(y | x) = Σ_z P(y, z | x)",
  },
  chain: {
    title: "Chain rule",
    sets: ["Y", "Z"],
    directions: [
      ["split", "Split joint"],
      ["combine", "Combine factors"],
    ],
    equation: "P(y, z | x) = P(y | z, x) P(z | x)",
  },
};

function singleSelection(root, selection) {
  if (selection.length !== 1)
    throw new Error(
      "Select one probability factor or one sum for this operation.",
    );
  const location = locateExpression(root, selection[0]);
  if (!location)
    throw new Error(
      "That selection is no longer in the expression. Select it again.",
    );
  return location;
}

function requireProbability(node) {
  if (node.type !== "probability")
    throw new Error(
      "Select an individual probability factor for this operation.",
    );
  return node.probability;
}

function finish(graph, expression, certificate, preferredSelection) {
  validateExpression(expression, graph);
  const selection = preferredSelection.filter((id) =>
    locateExpression(expression, id),
  );
  return {
    expression,
    certificate: structuredClone(certificate),
    selection: selection.length ? selection : [expression.id],
  };
}

/** Algebra checks syntax and variable membership only. It never tests the graph.
 * Interventions are a fixed context, copied unchanged to every resulting factor.
 */
export function applyMarginalization(graph, root, selection, direction, Z) {
  validateExpression(root, graph);
  validateVariables(Z, graph, "Z");
  const { node, ancestors } = singleSelection(root, selection);
  let replacement;
  if (direction === "expand") {
    const probability = requireProbability(node);
    const occupied = new Set(Object.values(probability).flat());
    if (Z.some((id) => occupied.has(id)))
      throw new Error(
        "To introduce a sum, Z must be absent from the selected probability's outcomes, observations, and actions.",
      );
    const bound = ancestors
      .filter((ancestor) => ancestor.type === "sum")
      .flatMap((ancestor) => ancestor.variables);
    if (Z.some((id) => bound.includes(id)))
      throw new Error(
        "Z is already summed over in this scope. Select a different variable; nested sums cannot reuse a bound variable.",
      );
    replacement = sumExpression(
      Z,
      probabilityExpression({
        ...probability,
        outcome: [...probability.outcome, ...Z],
      }),
      node.id,
    );
  } else if (direction === "collapse") {
    if (node.type !== "sum")
      throw new Error(
        "Select the whole sum using its Σ symbol to collapse it.",
      );
    if (!sameSet(node.variables, Z))
      throw new Error(
        "Z must contain exactly the variables bound by the selected sum.",
      );
    if (node.body.type !== "probability")
      throw new Error(
        "This sum must contain one joint probability. Combine its factors with the chain rule first.",
      );
    const probability = node.body.probability;
    if (!Z.every((id) => probability.outcome.includes(id)))
      throw new Error(
        "Every summed variable must be an outcome of the joint probability, not an observation or an action.",
      );
    const outcome = probability.outcome.filter((id) => !Z.includes(id));
    if (!outcome.length)
      throw new Error(
        "Keep at least one outcome. Reducing a normalized distribution to 1 is outside this MVP.",
      );
    replacement = probabilityExpression({ ...probability, outcome }, node.id);
  } else throw new Error("Unknown marginalization direction.");
  return finish(
    graph,
    replaceExpression(root, node.id, replacement),
    {
      kind: "marginalize",
      direction,
      sets: { Z },
      targets: [node.id],
    },
    [node.id],
  );
}

/** Resolve exactly two probability factors within the same product scope. */
function selectedPair(root, selection) {
  let parent, factors;
  if (selection.length === 1) {
    const { node } = singleSelection(root, selection);
    if (node.type !== "product" || node.factors.length !== 2)
      throw new Error(
        "Select a product of exactly two factors, or enable Multiple factors and select a pair within the same product.",
      );
    parent = node;
    factors = node.factors;
  } else if (selection.length === 2 && selection[0] !== selection[1]) {
    const locations = selection.map((id) => locateExpression(root, id));
    if (locations.some((location) => !location))
      throw new Error(
        "That selection is no longer in the expression. Select it again.",
      );
    parent = locations[0].parent;
    if (
      !parent ||
      parent.type !== "product" ||
      locations[1].parent?.id !== parent.id
    )
      throw new Error(
        "Select two factors in the same product. Factors across a summation boundary cannot be combined.",
      );
    factors = parent.factors.filter((factor) => selection.includes(factor.id));
  } else throw new Error("Select exactly two factors to combine.");
  factors.forEach(requireProbability);
  return { parent, factors };
}

export function applyChainRule(graph, root, selection, direction, Y, Z) {
  validateExpression(root, graph);
  validateVariables(Y, graph, "Y");
  validateVariables(Z, graph, "Z");
  if (Y.some((id) => Z.includes(id)))
    throw new Error("The two outcome sets Y and Z must be disjoint.");
  let expression, preferredSelection;
  if (direction === "split") {
    const { node } = singleSelection(root, selection);
    const probability = requireProbability(node);
    if (!sameSet(probability.outcome, [...Y, ...Z]))
      throw new Error(
        "Y and Z must partition all outcomes of the selected joint probability, with neither set empty.",
      );
    const conditional = probabilityExpression({
      ...probability,
      outcome: Y,
      observation: [...Z, ...probability.observation],
    });
    const marginal = probabilityExpression({ ...probability, outcome: Z });
    expression = replaceExpression(
      root,
      node.id,
      productExpression([conditional, marginal], node.id),
    );
    preferredSelection = locateExpression(expression, node.id)
      ? [node.id]
      : [conditional.id, marginal.id];
  } else if (direction === "combine") {
    const { parent, factors } = selectedPair(root, selection);
    const conditional = factors.find((factor) =>
      sameSet(factor.probability.outcome, Y),
    );
    const marginal = factors.find((factor) =>
      sameSet(factor.probability.outcome, Z),
    );
    if (!conditional || !marginal || conditional.id === marginal.id)
      throw new Error(
        "Y and Z must exactly match the two selected factors' outcome sets.",
      );
    const first = conditional.probability,
      second = marginal.probability;
    if (!sameSet(first.intervention, second.intervention))
      throw new Error(
        "The selected factors must have exactly the same do(...) conditions.",
      );
    if (!sameSet(first.observation, [...Z, ...second.observation]))
      throw new Error(
        "To combine, the Y factor must condition on exactly Z plus the observations in the Z factor.",
      );
    const combined = probabilityExpression(
      {
        outcome: [...Y, ...Z],
        observation: second.observation,
        intervention: second.intervention,
      },
      factors[0].id,
    );
    // Insert where the first selected factor stood, preserving all other factors.
    const ids = new Set(factors.map((factor) => factor.id));
    const remaining = parent.factors.flatMap((factor) =>
      factor.id === factors[0].id
        ? [combined]
        : ids.has(factor.id)
          ? []
          : [factor],
    );
    const replacement =
      remaining.length === 1
        ? { ...combined, id: parent.id }
        : productExpression(remaining, parent.id);
    expression = replaceExpression(root, parent.id, replacement);
    preferredSelection = [remaining.length === 1 ? parent.id : combined.id];
  } else throw new Error("Unknown chain-rule direction.");
  return finish(
    graph,
    expression,
    {
      kind: "chain",
      direction,
      sets: { Y, Z },
      targets: [...selection],
    },
    preferredSelection,
  );
}

/** The existing verifier sees just the selected factor; surrounding sums and
 * factors are retained. Bound values may appear in a factor's do(...) context.
 */
export function applyDoCalculus(graph, root, selection, rule, direction, sets) {
  validateExpression(root, graph);
  const { node } = singleSelection(root, selection);
  const result = applyRule(
    graph,
    requireProbability(node),
    rule,
    direction,
    sets,
  );
  return finish(
    graph,
    replaceExpression(
      root,
      node.id,
      probabilityExpression(result.probability, node.id),
    ),
    { ...result.certificate, kind: "do-calculus", targets: [node.id] },
    [node.id],
  );
}
