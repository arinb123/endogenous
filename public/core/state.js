import { validateGraph } from "./graph.js";
import { validateLabel, validateProbability } from "./probability.js";
import { reserveExpressionIds, validateExpression } from "./expression.js";
import { replayHistory, sameExpression } from "./lemmas.js";

export const MAX_STATE_BYTES = 10 * 1024 * 1024;
const FORMAT = "endogenous-workbench";
const VERSION = 1;
const LIMITS = {
  nodes: 128, edges: 512, lemmas: 100, history: 1000,
  expressionDepth: 64, expressionNodes: 2000, totalExpressionNodes: 50000,
  totalSteps: 2000, checks: 2000, replayWork: 10000000,
};

const fail = (message) => { throw new Error(`Invalid state file: ${message}`); };
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function object(value, required, name, optional = []) {
  if (!isObject(value)) fail(`${name} must be an object.`);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.hasOwn(value, key))) fail(`${name} is missing a required field.`);
  if (keys.some((key) => !required.includes(key) && !optional.includes(key))) fail(`${name} contains an unknown field.`);
}

function array(value, name, maximum) {
  if (!Array.isArray(value) || value.length > maximum) fail(`${name} must be an array with at most ${maximum} entries.`);
}

function string(value, name, maximum = 256, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value.length) || value.length > maximum)
    fail(`${name} must be ${allowEmpty ? "a" : "a nonempty"} string of at most ${maximum} characters.`);
}

function integer(value, name, maximum = 1000000) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(`${name} must be a nonnegative integer no greater than ${maximum}.`);
}

function ids(value, name, maximum = LIMITS.nodes, allowEmpty = true) {
  array(value, name, maximum);
  if (!allowEmpty && !value.length) fail(`${name} must not be empty.`);
  value.forEach((id) => string(id, `${name} ID`));
  if (new Set(value).size !== value.length) fail(`${name} contains duplicate IDs.`);
}

/** Bound JSON structure before any recursive expression/core operation. */
function inspectJSON(root) {
  const pending = [{ value: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { value, depth } = pending.pop();
    if (++count > 250000 || depth > 160) fail("The file contains too much data or is nested too deeply.");
    if (typeof value === "number" && !Number.isFinite(value)) fail("All numbers must be finite.");
    if (typeof value === "string" && value.length > 65536) fail("A string in the file is too long.");
    if (Array.isArray(value)) {
      if (value.length > 10000) fail("An array in the file is too large.");
      value.forEach((child) => pending.push({ value: child, depth: depth + 1 }));
    } else if (isObject(value)) {
      if (Object.keys(value).length > 10000) fail("An object in the file is too large.");
      Object.values(value).forEach((child) => pending.push({ value: child, depth: depth + 1 }));
    }
  }
}

/** Object-key order is immaterial; array order, IDs, and every stored value are exact. */
function equalData(left, right) {
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((item, i) => equalData(item, right[i]));
  if (!isObject(left) || !isObject(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && equalData(left[key], right[key]));
}

function graphShape(graph, name) {
  object(graph, ["nodes", "edges"], name);
  array(graph.nodes, `${name}.nodes`, LIMITS.nodes);
  array(graph.edges, `${name}.edges`, LIMITS.edges);
  const labels = new Set();
  graph.nodes.forEach((node) => {
    object(node, ["id", "label", "x", "y"], "Graph node");
    string(node.id, "Node ID");
    string(node.label, "Node label", 32);
    validateLabel(node.label);
    if (labels.has(node.label)) fail("Node labels must be unique within a graph.");
    labels.add(node.label);
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) fail("Node positions must be finite numbers.");
  });
  graph.edges.forEach((edge) => {
    object(edge, ["id", "source", "target", "type"], "Graph edge");
    for (const key of ["id", "source", "target"]) string(edge[key], `Edge ${key}`);
    if (!["directed", "bidirected"].includes(edge.type)) fail("An edge has an unknown type.");
  });
  validateGraph(graph);
}

function probabilityShape(probability, graph) {
  object(probability, ["outcome", "intervention", "observation"], "Probability");
  ids(probability.outcome, "Probability outcomes", LIMITS.nodes, false);
  ids(probability.intervention, "Probability interventions");
  ids(probability.observation, "Probability observations");
  validateProbability(probability, graph);
}

function expressionShape(root, graph, context) {
  let count = 0;
  function visit(node, depth) {
    if (++count > LIMITS.expressionNodes || ++context.expressionNodes > LIMITS.totalExpressionNodes || depth > LIMITS.expressionDepth)
      fail("Expressions are too large or nested too deeply.");
    if (!isObject(node)) fail("An expression node must be an object.");
    string(node.id, "Expression ID");
    if (node.type === "probability") {
      object(node, ["type", "id", "probability"], "Probability expression");
      probabilityShape(node.probability, graph);
    } else if (node.type === "sum") {
      object(node, ["type", "id", "variables", "body"], "Sum expression");
      ids(node.variables, "Summation variables", LIMITS.nodes, false);
      visit(node.body, depth + 1);
    } else if (node.type === "product") {
      object(node, ["type", "id", "factors"], "Product expression");
      array(node.factors, "Product factors", LIMITS.expressionNodes);
      node.factors.forEach((factor) => visit(factor, depth + 1));
    } else fail("An expression has an unknown type.");
  }
  visit(root, 0);
  validateExpression(root, graph);
  context.expressions.push(root);
}

function setsShape(sets, names) {
  object(sets, names, "Rule sets");
  names.forEach((name) => ids(sets[name], `Set ${name}`));
}

function checksShape(checks, graph) {
  array(checks, "Lemma assumptions", LIMITS.checks);
  checks.forEach((check) => {
    object(check, ["probability", "rule", "direction", "sets"], "Lemma assumption");
    probabilityShape(check.probability, graph);
    if (![1, 2, 3].includes(check.rule)) fail("A lemma assumption has an unknown rule.");
    string(check.direction, "Assumption direction", 32);
    setsShape(check.sets, ["X", "Z", "Y", "W"]);
  });
}

function linesShape(lines) {
  object(lines, ["l1", "l2"], "Lemma line references");
  integer(lines.l1, "First lemma line");
  integer(lines.l2, "Second lemma line");
}

function certificateShape(certificate, graph) {
  if (!isObject(certificate)) fail("Every noninitial line needs a certificate.");
  const c = certificate;
  ids(c.targets, "Certificate targets", LIMITS.expressionNodes, false);
  string(c.direction, "Certificate direction", 32);
  if (c.kind === "do-calculus") {
    object(c, ["kind", "targets", "rule", "direction", "sets", "incoming", "outgoing", "zW", "conditioned", "removedEdges"], "Do-calculus certificate");
    if (![1, 2, 3].includes(c.rule)) fail("A certificate has an unknown do-calculus rule.");
    setsShape(c.sets, ["X", "Z", "Y", "W"]);
    for (const key of ["incoming", "outgoing", "zW", "conditioned"]) ids(c[key], `Certificate ${key}`);
    ids(c.removedEdges, "Removed edge IDs", LIMITS.edges);
  } else if (c.kind === "marginalize" || c.kind === "chain") {
    object(c, ["kind", "targets", "direction", "sets"], "Algebra certificate");
    setsShape(c.sets, c.kind === "chain" ? ["Y", "Z"] : ["Z"]);
  } else if (c.kind === "lemma") {
    object(c, ["kind", "lemmaId", "name", "direction", "lines", "targets", "sets", "checks"], "Lemma certificate");
    string(c.lemmaId, "Referenced lemma ID");
    string(c.name, "Referenced lemma name", 200);
    linesShape(c.lines);
    setsShape(c.sets, []);
    checksShape(c.checks, graph);
  } else fail("A certificate has an unknown kind.");
}

function historyShape(history, graph, context, allowEmpty = false) {
  array(history, "Derivation history", LIMITS.history);
  if (!allowEmpty && !history.length) fail("A proof history must not be empty.");
  context.steps += Math.max(0, history.length - 1);
  if (context.steps > LIMITS.totalSteps) fail("The file contains too many proof steps.");
  history.forEach((step, index) => {
    object(step, ["expression", "certificate"], "Derivation line");
    expressionShape(step.expression, graph, context);
    if (!index) {
      if (step.certificate !== null) fail("The first line of a proof must have a null certificate.");
    } else certificateShape(step.certificate, graph);
  });
}

function lemmaShape(lemma, context) {
  object(lemma, ["id", "name", "lines", "labels", "left", "right", "checks", "proof"], "Saved lemma");
  string(lemma.id, "Lemma ID");
  string(lemma.name, "Lemma name", 200);
  linesShape(lemma.lines);
  object(lemma.proof, ["graph", "history", "l1", "l2"], "Lemma proof");
  const proof = lemma.proof;
  graphShape(proof.graph, "Lemma proof graph");
  historyShape(proof.history, proof.graph, context);
  integer(proof.l1, "Proof first line", proof.history.length - 1);
  integer(proof.l2, "Proof second line", proof.history.length - 1);
  if (proof.l1 === proof.l2 || Math.min(proof.l1, proof.l2) !== 0 || Math.max(proof.l1, proof.l2) !== proof.history.length - 1)
    fail("A lemma proof must span exactly its two endpoints.");
  const first = Math.min(lemma.lines.l1, lemma.lines.l2);
  if (proof.l1 !== lemma.lines.l1 - first || proof.l2 !== lemma.lines.l2 - first)
    fail("Lemma line references do not match its proof interval.");
  expressionShape(lemma.left, proof.graph, context);
  expressionShape(lemma.right, proof.graph, context);
  checksShape(lemma.checks, proof.graph);
  object(lemma.labels, proof.graph.nodes.map((node) => node.id), "Saved lemma labels");
  const expectedLabels = Object.fromEntries(proof.graph.nodes.map((node) => [node.id, node.label]));
  if (!equalData(lemma.labels, expectedLabels)) fail("Saved lemma labels differ from its original proof graph.");
}

/** Bound expanded dependency obligations before replay. This prevents a small
 * dependency graph from manufacturing exponentially many inherited checks.
 */
function checkedHistory(graph, history, verifiedLemmas, context) {
  let checks = 0;
  for (const { certificate: c } of history.slice(1)) {
    if (c.kind === "do-calculus") checks++;
    else if (c.kind === "lemma") {
      const dependency = verifiedLemmas.find((lemma) => lemma.id === c.lemmaId);
      if (!dependency) fail("A lemma dependency is missing, cyclic, or appears after its dependent lemma.");
      checks += dependency.checks.length;
    }
  }
  if (checks > LIMITS.checks) fail("A proof expands to too many lemma assumptions.");
  const parentCounts = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    parentCounts.set(edge.target, parentCounts.get(edge.target) + 1);
    if (edge.type === "bidirected") parentCounts.set(edge.source, parentCounts.get(edge.source) + 1);
  }
  const graphWork = graph.nodes.length + graph.edges.length + [...parentCounts.values()].reduce((sum, n) => sum + n * n, 0);
  context.replayWork += history.length + checks * Math.max(1, graphWork);
  if (context.replayWork > LIMITS.replayWork) fail("The file requires too much proof verification work.");
  const replayed = replayHistory(graph, history, verifiedLemmas);
  replayed.certificates.forEach((certificate, index) => {
    if (!equalData(certificate, history[index + 1].certificate))
      fail("A stored certificate differs from its checked justification.");
  });
  return replayed.checks;
}

/** Parse a complete detached session. No document/library mutation occurs here.
 * All saved IDs and layout values survive validation exactly as written.
 */
export function parseState(text) {
  if (typeof text !== "string") fail("Expected JSON text.");
  if (text.length > MAX_STATE_BYTES || new TextEncoder().encode(text).length > MAX_STATE_BYTES)
    fail("The file is larger than 10 MB.");
  let saved;
  try { saved = JSON.parse(text); } catch { fail("The file is not valid JSON."); }
  inspectJSON(saved);
  object(saved, ["format", "version", "document", "lemmas"], "State envelope", ["savedAt"]);
  if (saved.format !== FORMAT || saved.version !== VERSION) fail("Unsupported state format or version.");
  if (Object.hasOwn(saved, "savedAt")) string(saved.savedAt, "Save timestamp", 100);
  const context = { expressionNodes: 0, expressions: [], steps: 0, replayWork: 0 };
  const document = saved.document;
  object(document, ["graph", "initial", "current", "history"], "Document");
  graphShape(document.graph, "Document graph");
  historyShape(document.history, document.graph, context, true);
  if (document.initial === null) {
    if (document.current !== null || document.history.length) fail("An unstarted document cannot contain a current expression or history.");
  } else {
    probabilityShape(document.initial, document.graph);
    expressionShape(document.current, document.graph, context);
    const first = document.history[0]?.expression;
    if (first?.type !== "probability" || !equalData(first.probability, document.initial))
      fail("The initial probability does not match the first derivation line.");
    if (!equalData(document.current, document.history.at(-1).expression))
      fail("The current expression must exactly match the last derivation line, including IDs.");
  }
  array(saved.lemmas, "Saved lemma library", LIMITS.lemmas);
  const lemmaIds = new Set();
  for (const lemma of saved.lemmas) {
    lemmaShape(lemma, context);
    if (lemmaIds.has(lemma.id)) fail("Saved lemma IDs must be unique.");
    lemmaIds.add(lemma.id);
  }
  // Reserve before replay creates temporary syntax. Numeric suffixes are never
  // trusted as a counter, so even huge imported IDs cannot stall ID generation.
  reserveExpressionIds(context.expressions);
  const verifiedLemmas = [];
  for (const lemma of saved.lemmas) {
    const proof = lemma.proof;
    const checks = checkedHistory(proof.graph, proof.history, verifiedLemmas, context);
    if (!equalData(lemma.left, proof.history[proof.l1].expression) || !equalData(lemma.right, proof.history[proof.l2].expression))
      fail("Saved lemma sides differ from its proven endpoints.");
    if (sameExpression(lemma.left, lemma.right)) fail("A saved lemma must relate two different expressions.");
    if (!equalData(lemma.checks, checks)) fail("Saved lemma assumptions differ from its checked proof.");
    verifiedLemmas.push(lemma);
  }
  checkedHistory(document.graph, document.history, verifiedLemmas, context);
  return { document, lemmas: saved.lemmas };
}

/** Export the same versioned format accepted by parseState, with readable JSON. */
export function serializeState(documentState, lemmas) {
  let text;
  try { text = JSON.stringify({ format: FORMAT, version: VERSION, document: documentState, lemmas }, null, 2); }
  catch { throw new Error("The session contains data that cannot be saved as JSON."); }
  parseState(text);
  return text;
}
