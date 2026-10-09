import { formatProbability, validateProbability } from "./probability.js";

// Expression IDs describe selectable syntax nodes, independently of graph IDs.
// They only need to be unique in this in-memory editing session.
let sequence = 0;
const reservedIds = new Set();
const nextId = () => {
  let id;
  do { id = `expression-${++sequence}`; } while (reservedIds.has(id));
  reservedIds.add(id);
  return id;
};

/** Reserve existing IDs without changing snapshots or trusting numeric suffixes.
 * Call after bounded shape validation and before replaying imported operations.
 */
export function reserveExpressionIds(expressions) {
  const pending = Array.isArray(expressions) ? [...expressions] : [expressions];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    reservedIds.add(node.id);
    if (node.type === "sum") pending.push(node.body);
    else if (node.type === "product") pending.push(...node.factors);
  }
}
export const sameSet = (left, right) =>
  left.length === right.length && left.every((id) => right.includes(id));

export function probabilityExpression(probability, id = nextId()) {
  return { type: "probability", id, probability: structuredClone(probability) };
}

export function sumExpression(variables, body, id = nextId()) {
  return {
    type: "sum",
    id,
    variables: [...variables],
    body: structuredClone(body),
  };
}

export function productExpression(factors, id = nextId()) {
  return normalizeExpression({ type: "product", id, factors });
}

/** Scalar multiplication is represented as one ordered list. We never move a
 * factor into or out of a sum, reorder factors, distribute, or cancel sums.
 */
function normalizeExpression(expression) {
  if (expression.type === "probability") return structuredClone(expression);
  if (expression.type === "sum") {
    return {
      ...expression,
      variables: [...expression.variables],
      body: normalizeExpression(expression.body),
    };
  }
  const factors = expression.factors
    .map(normalizeExpression)
    .flatMap((factor) =>
      factor.type === "product" ? factor.factors : [factor],
    );
  if (factors.length === 1) return { ...factors[0], id: expression.id };
  return { ...expression, factors };
}

export function locateExpression(root, id, parent = null, ancestors = []) {
  if (!root) return null;
  if (root.id === id) return { node: root, parent, ancestors };
  const children =
    root.type === "sum"
      ? [root.body]
      : root.type === "product"
        ? root.factors
        : [];
  for (const child of children) {
    const found = locateExpression(child, id, root, [...ancestors, root]);
    if (found) return found;
  }
  return null;
}

/** Immutable, exact subtree replacement. Normalization only groups products. */
export function replaceExpression(root, id, replacement) {
  if (!locateExpression(root, id))
    throw new Error(
      "That selection is no longer in the expression. Select it again.",
    );
  function replace(node) {
    if (node.id === id) return replacement;
    if (node.type === "sum") return { ...node, body: replace(node.body) };
    if (node.type === "product")
      return { ...node, factors: node.factors.map(replace) };
    return node;
  }
  return normalizeExpression(replace(root));
}

export function validateVariables(variables, graph, name, allowEmpty = false) {
  if (!Array.isArray(variables) || (!allowEmpty && !variables.length))
    throw new Error(`Select at least one node in ${name}.`);
  if (new Set(variables).size !== variables.length)
    throw new Error(`${name} must not contain duplicates.`);
  const known = new Set(graph.nodes.map((node) => node.id));
  if (variables.some((id) => !known.has(id)))
    throw new Error(`${name} contains a node that is not in this graph.`);
}

export function validateExpression(root, graph) {
  const ids = new Set();
  function visit(node, bound) {
    if (!node || typeof node.id !== "string" || !node.id || ids.has(node.id))
      throw new Error("Expression IDs must be present and unique.");
    ids.add(node.id);
    if (node.type === "probability")
      validateProbability(node.probability, graph);
    else if (node.type === "product") {
      if (!Array.isArray(node.factors) || node.factors.length < 2)
        throw new Error("A product must have at least two factors.");
      node.factors.forEach((factor) => visit(factor, bound));
    } else if (node.type === "sum") {
      validateVariables(node.variables, graph, "the summation set");
      if (node.variables.some((id) => bound.has(id)))
        throw new Error(
          "A variable is already summed over in this scope. Nested sums must use distinct variables.",
        );
      visit(node.body, new Set([...bound, ...node.variables]));
    } else throw new Error("Unknown expression type.");
  }
  visit(root, new Set());
  return root;
}

export function freeVariables(expression) {
  if (expression.type === "probability")
    return new Set(Object.values(expression.probability).flat());
  if (expression.type === "sum")
    return new Set(
      [...freeVariables(expression.body)].filter(
        (id) => !expression.variables.includes(id),
      ),
    );
  return new Set(
    expression.factors.flatMap((factor) => [...freeVariables(factor)]),
  );
}

/** Explicit brackets make the scope of every sum/product visible in history. */
export function formatExpression(expression, label = (id) => id) {
  if (!expression) return "Define a probability to begin";
  if (expression.type === "probability")
    return formatProbability(expression.probability, label);
  if (expression.type === "sum")
    return `Σ_{${expression.variables.map(label).join(", ")}} [${formatExpression(expression.body, label)}]`;
  return `(${expression.factors.map((factor) => formatExpression(factor, label)).join(" · ")})`;
}
