import { applyRule } from "./calculus.js";
import {
  applyChainRule,
  applyDoCalculus,
  applyMarginalization,
} from "./algebra.js";
import {
  locateExpression,
  probabilityExpression,
  productExpression,
  sumExpression,
  replaceExpression,
  sameSet,
  validateExpression,
} from "./expression.js";

/** Exact variable names and summation scopes; IDs and order within sets are not
 * mathematical content. Products retain their displayed factor order.
 */
export function sameExpression(left, right) {
  if (!left || !right || left.type !== right.type) return false;
  if (left.type === "probability")
    return ["outcome", "intervention", "observation"].every((key) =>
      sameSet(left.probability[key], right.probability[key]),
    );
  if (left.type === "sum")
    return (
      sameSet(left.variables, right.variables) &&
      sameExpression(left.body, right.body)
    );
  return (
    left.factors.length === right.factors.length &&
    left.factors.every((factor, index) =>
      sameExpression(factor, right.factors[index]),
    )
  );
}

function freshExpression(node, id) {
  if (node.type === "probability")
    return probabilityExpression(node.probability, id);
  if (node.type === "sum")
    return sumExpression(node.variables, freshExpression(node.body), id);
  return productExpression(
    node.factors.map((factor) => freshExpression(factor)),
    id,
  );
}

/** Recheck the actual rule inputs, rather than stale edge cuts. In particular,
 * Rule 3's ancestor set must be recomputed when the graph changes.
 */
function checkAssumptions(graph, checks) {
  for (const check of checks) {
    try {
      applyRule(
        graph,
        check.probability,
        check.rule,
        check.direction,
        check.sets,
      );
    } catch (error) {
      throw new Error(
        `This lemma's Rule ${check.rule} assumption does not hold in the current graph. ${error.message}`,
      );
    }
  }
}

function selectedExpression(root, selection) {
  if (!selection.length || new Set(selection).size !== selection.length)
    throw new Error("Select the expression to replace with this lemma.");
  const locations = selection.map((id) => locateExpression(root, id));
  if (locations.some((location) => !location))
    throw new Error(
      "That selection is no longer in the expression. Select it again.",
    );
  if (locations.length === 1) return { node: locations[0].node };
  const parent = locations[0].parent;
  if (
    parent?.type !== "product" ||
    locations.some((location) => location.parent?.id !== parent.id)
  )
    throw new Error(
      "Select factors in the same product. A lemma cannot replace a selection across a summation boundary.",
    );
  const factors = parent.factors.filter((factor) =>
    selection.includes(factor.id),
  );
  return { node: productExpression(factors), parent, factors };
}

/** Lemmas are pointwise equalities, including when one side drops a free
 * variable. Substitution is valid beneath a sum. Fresh syntax IDs avoid
 * collisions; validateExpression rejects nested rebinding of a dummy variable.
 */
export function applyLemma(graph, root, selection, lemma, direction) {
  if (!["forward", "reverse"].includes(direction))
    throw new Error("Unknown lemma direction.");
  validateExpression(root, graph);
  validateExpression(lemma.left, graph);
  validateExpression(lemma.right, graph);
  const source = direction === "forward" ? lemma.left : lemma.right;
  const target = direction === "forward" ? lemma.right : lemma.left;
  const { node, parent, factors } = selectedExpression(root, selection);
  if (!sameExpression(node, source))
    throw new Error(
      "The selected expression does not match this side of the lemma. Match its variables, conditions, factor order, and summation scope exactly.",
    );
  checkAssumptions(graph, lemma.checks);
  const replacement = freshExpression(
    target,
    factors ? factors[0].id : node.id,
  );
  let expression;
  if (!parent) expression = replaceExpression(root, node.id, replacement);
  else {
    const remaining = parent.factors.flatMap((factor) =>
      factor.id === factors[0].id
        ? [replacement]
        : selection.includes(factor.id)
          ? []
          : [factor],
    );
    const group =
      remaining.length === 1
        ? { ...replacement, id: parent.id }
        : productExpression(remaining, parent.id);
    expression = replaceExpression(root, parent.id, group);
  }
  validateExpression(expression, graph);
  const selectedId = locateExpression(expression, replacement.id)
    ? replacement.id
    : parent?.id;
  return {
    expression,
    selection: [
      selectedId && locateExpression(expression, selectedId)
        ? selectedId
        : expression.id,
    ],
    certificate: {
      kind: "lemma",
      lemmaId: lemma.id,
      name: lemma.name,
      direction,
      lines: { ...lemma.lines },
      targets: [...selection],
      sets: {},
      checks: structuredClone(lemma.checks),
    },
  };
}

/** Replay one recorded transition without trusting its cached edge cuts or
 * inherited checks. The caller supplies previously verified saved lemmas.
 */
export function replayStep(graph, before, certificate, lemmas = []) {
  const c = certificate;
  if (!c) throw new Error("Every step must have a checked justification.");
  let result;
  let checks = [];
  if (c.kind === "do-calculus") {
    result = applyDoCalculus(graph, before, c.targets, c.rule, c.direction, c.sets);
    checks = [{
      probability: structuredClone(locateExpression(before, c.targets[0]).node.probability),
      rule: c.rule, direction: c.direction, sets: structuredClone(c.sets),
    }];
  } else if (c.kind === "marginalize") {
    result = applyMarginalization(graph, before, c.targets, c.direction, c.sets.Z);
  } else if (c.kind === "chain") {
    result = applyChainRule(graph, before, c.targets, c.direction, c.sets.Y, c.sets.Z);
  } else if (c.kind === "lemma") {
    const dependency = lemmas.find((lemma) => lemma.id === c.lemmaId);
    if (!dependency) throw new Error("A lemma used in these lines is no longer available.");
    result = applyLemma(graph, before, c.targets, dependency, c.direction);
    checks = structuredClone(dependency.checks);
  } else throw new Error("Unknown derivation justification.");
  return { ...result, checks };
}

/** Replay against recorded snapshots, preserving their IDs for later targets.
 * Recomputed certificates are returned for strict file-import verification.
 */
export function replayHistory(graph, history, lemmas = []) {
  const checks = [];
  const certificates = [];
  history.forEach((step, index) => {
    validateExpression(step.expression, graph);
    if (!index) return;
    const result = replayStep(graph, history[index - 1].expression, step.certificate, lemmas);
    if (!sameExpression(result.expression, step.expression))
      throw new Error("A recorded step does not match its checked justification.");
    checks.push(...result.checks);
    certificates.push(result.certificate);
  });
  return { checks, certificates };
}

/** Save only equalities supported by checked transitions. The self-contained
 * proof interval retains its original graph; lemma dependencies are referenced
 * by ID and resolved from the saved library when the proof is verified.
 */
export function createLemma(graph, history, l1, l2, identity, lemmas = []) {
  if (![l1, l2].every((line) => Number.isInteger(line) && line >= 0 && line < history.length))
    throw new Error("Choose two existing derivation lines.");
  if (l1 === l2) throw new Error("Choose two different derivation lines.");
  const first = Math.min(l1, l2);
  const interval = structuredClone(history.slice(first, Math.max(l1, l2) + 1));
  interval[0].certificate = null;
  const { checks } = replayHistory(graph, interval, lemmas);
  if (sameExpression(history[l1].expression, history[l2].expression))
    throw new Error("These two lines already have the same expression.");
  return {
    id: identity.id,
    name: identity.name,
    lines: { l1, l2 },
    labels: Object.fromEntries(graph.nodes.map((node) => [node.id, node.label])),
    left: structuredClone(history[l1].expression),
    right: structuredClone(history[l2].expression),
    checks,
    proof: {
      graph: structuredClone(graph), history: interval,
      l1: l1 - first, l2: l2 - first,
    },
  };
}
