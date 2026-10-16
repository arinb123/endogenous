import test from "node:test";
import assert from "node:assert/strict";
import { parseProbability, formatProbability, variableName, valueName } from "../public/core/probability.js";
import { probabilityExpression, productExpression, sumExpression, formatExpression } from "../public/core/expression.js";
import { expressionLatex, buildProof } from "../public/core/proof-export.js";
import { applyMarginalization } from "../public/core/algebra.js";
import { createLemma } from "../public/core/lemmas.js";
import { parseState, serializeState } from "../public/core/state.js";

const probability = (outcome, intervention = [], observation = []) => ({ outcome, intervention, observation });
const P = (...sets) => probabilityExpression(probability(...sets));
const uppercaseLabel = (id) => id.toUpperCase();

test("probability input resolves value names to capitalized variables", () => {
  const expected = probability(["Y"], ["X"], ["AGE"]);
  assert.deepEqual(parseProbability("P(y | do(x), age)"), expected);
  assert.deepEqual(parseProbability("P(Y | do(X), Age)"), expected);
  assert.deepEqual(parseProbability(formatProbability(expected)), expected);
  // A variable named DO remains distinct from the do(...) syntax.
  assert.deepEqual(parseProbability("P(do | x)"), probability(["DO"], [], ["X"]));
});

test("mixed-case aliases cannot duplicate a variable within a probability", () => {
  for (const input of ["P(y,Y)", "P(y | do(Y))", "P(y | x,X)", "P(y | do(x), X)"])
    assert.throws(() => parseProbability(input), /once|duplicate|disjoint/iu, input);
});

test("Unicode variable and value casing round-trips through the probability input", () => {
  assert.equal(variableName("β"), "Β");
  assert.equal(valueName("Β"), "β");
  assert.equal(variableName("straße"), "STRASSE");
  assert.equal(valueName("STRASSE"), "strasse");
  for (const name of ["ẞ", "ß", "ϴ", "ϑ", "İ", "ı"]) {
    assert.equal(variableName(valueName(name)), variableName(name));
    assert.equal(valueName(valueName(name)), valueName(name));
  }
  const sharpS = sumExpression(["letter"], P(["letter"]));
  assert.equal(formatExpression(sharpS, () => "ẞ"), "Σ_{ss′} [P(ss′)]");
  assert.equal(variableName("i\u0307"), "İ");
  const original = probability(["Β", "İ"], [], ["CAFÉ"]);
  assert.deepEqual(parseProbability(formatProbability(original)), original);
  const maximumLength = probability(["İ".repeat(32)]);
  assert.deepEqual(parseProbability(formatProbability(maximumLength)), maximumLength);
  assert.throws(() => parseProbability(`P(${"ß".repeat(17)})`), /32|up to/iu);
  assert.throws(() => parseProbability("P(ß, ss)"), /once|duplicate|disjoint/iu);
});

test("probability and sum expressions render lowercase values under uppercase variable labels", () => {
  assert.equal(formatProbability(probability(["y"], ["x"], ["z"]), uppercaseLabel), "P(y | do(x), z)");
  const expression = productExpression([
    P(["z"], ["x"]),
    sumExpression(["x"], P(["y", "x"], [], ["z"])),
  ]);
  assert.equal(formatExpression(expression, uppercaseLabel), "(P(z | do(x)) · Σ_{x′} [P(y, x′ | z)])");
  assert.equal(expressionLatex(expression, uppercaseLabel),
    "\\left[P\\!\\left(\\mathrm{z} \\mid \\operatorname{do}\\!\\left(\\mathrm{x}\\right)\\right) \\cdot \\sum_{\\mathrm{x}^{\\prime}}\\!\\left[P\\!\\left(\\mathrm{y}, \\mathrm{x}^{\\prime} \\mid \\mathrm{z}\\right)\\right]\\right]");
});

function legacyDocument() {
  const graph = {
    nodes: ["x", "y", "z"].map((label, index) => ({ id: `node-${label}`, label, x: 100 + index * 200, y: 200 })),
    edges: [],
  };
  const initial = P(["node-y"], ["node-x"]);
  const expanded = applyMarginalization(graph, initial, [initial.id], "expand", ["node-z"]);
  const history = [
    { expression: initial, certificate: null },
    { expression: expanded.expression, certificate: expanded.certificate },
  ];
  return { graph, initial: initial.probability, current: expanded.expression, history };
}

test("legacy lowercase state and lemma labels retain their exact graph and expression identities", () => {
  const document = legacyDocument();
  const lemma = createLemma(document.graph, document.history, 0, 1, { id: "saved-equality", name: "Lemma 1" });
  const restored = parseState(serializeState(document, [lemma]));
  assert.deepEqual(restored, { document, lemmas: [lemma] });
  const label = (id) => restored.document.graph.nodes.find((node) => node.id === id).label;
  assert.equal(formatExpression(restored.document.current, label), "Σ_{z′} [P(y, z′ | do(x))]");
  assert.deepEqual(restored.lemmas[0].labels, { "node-x": "x", "node-y": "y", "node-z": "z" });
});

test("proof captions name uppercase variables while displayed equations use lowercase values", () => {
  const blocks = buildProof(legacyDocument()).sections[0].blocks;
  assert.equal(blocks[2].latex, "\\text{(2) Marginalize, with}\\quad Z = \\left\\{\\mathrm{Z}\\right\\}");
  assert.match(blocks[3].latex, /\\sum_\{\\mathrm\{z\}\^\{\\prime\}\}/u);
  assert.doesNotMatch(blocks[2].latex, /\\prime/u);
});

test("import rejects case-colliding legacy nodes instead of merging distinct identities", () => {
  const document = {
    graph: {
      nodes: ["x", "X"].map((label, index) => ({ id: `distinct-${index}`, label, x: 100 + index * 200, y: 200 })),
      edges: [],
    },
    initial: null, current: null, history: [],
  };
  const file = JSON.stringify({ format: "endogenous-workbench", version: 1, document, lemmas: [] });
  assert.throws(() => parseState(file), /unique|case|ambiguous|same/iu);
});
