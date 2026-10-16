import test from "node:test";
import assert from "node:assert/strict";
import {
  probabilityExpression,
  productExpression,
  sumExpression,
  formatExpression,
  labelsAtExpression,
} from "../public/core/expression.js";
import { applyMarginalization, applyChainRule, applyDoCalculus } from "../public/core/algebra.js";
import { createLemma, applyLemma } from "../public/core/lemmas.js";
import { buildProof, expressionLatex, exportMarkdown, exportLatex } from "../public/core/proof-export.js";
import { parseState, serializeState } from "../public/core/state.js";

const graph = {
  nodes: ["x", "y", "z", "w"].map((id, index) => ({ id, label: id, x: index * 100, y: 100 })),
  edges: [],
};
const P = (outcome, intervention = [], observation = []) =>
  probabilityExpression({ outcome, intervention, observation });
const label = (id) => id;

function append(history, result) {
  history.push({ expression: result.expression, certificate: result.certificate });
  return result.expression;
}

function documentFrom(history) {
  return {
    graph: structuredClone(graph),
    initial: structuredClone(history[0].expression.probability),
    current: structuredClone(history.at(-1).expression),
    history: structuredClone(history),
  };
}

function scopedHistory() {
  const initial = P(["y"], ["x"]);
  const history = [{ expression: initial, certificate: null }];
  let current = append(history, applyMarginalization(graph, initial, [initial.id], "expand", ["z"]));
  current = append(history, applyChainRule(graph, current, [current.body.id], "split", ["y"], ["z"]));
  append(history, applyDoCalculus(graph, current, [current.body.factors[0].id], 2, "to-action", {
    X: ["x"], Y: ["y"], Z: ["z"], W: [],
  }));
  return history;
}

test("front-door notation distinguishes a locally summed treatment from its fixed sibling", () => {
  const conditional = P(["y"], [], ["z", "x"]);
  const localTreatment = sumExpression(["x"], productExpression([conditional, P(["x"])]));
  const fixedTreatment = P(["z"], ["x"]);
  const expression = sumExpression(["z"], productExpression([localTreatment, fixedTreatment]));
  const snapshot = structuredClone(expression);

  assert.equal(formatExpression(expression),
    "Σ_{z′} [(Σ_{x′} [(P(y | z′, x′) · P(x′))] · P(z′ | do(x)))]");
  assert.equal(formatExpression(conditional, labelsAtExpression(expression, conditional.id, label)),
    "P(y | z′, x′)");
  assert.equal(formatExpression(fixedTreatment, labelsAtExpression(expression, fixedTreatment.id, label)),
    "P(z′ | do(x))");
  assert.equal(formatExpression(localTreatment, labelsAtExpression(expression, localTreatment.id, label)),
    "Σ_{x′} [(P(y | z′, x′) · P(x′))]");
  assert.deepEqual(expression, snapshot);
});

test("multivariable and sibling sums prime bound actions and observations without leaking scope", () => {
  const expression = productExpression([
    sumExpression(["x", "w"], P(["y"], ["x"], ["w"])),
    sumExpression(["x"], P(["z"], [], ["x"])),
    P(["x"], [], ["w"]),
  ]);
  assert.equal(formatExpression(expression),
    "(Σ_{x′, w′} [P(y | do(x′), w′)] · Σ_{x′} [P(z | x′)] · P(x | w))");
});

test("LaTeX primes are structural math and leave fixed contexts unprimed", () => {
  const expression = sumExpression(["z"], productExpression([
    sumExpression(["x"], P(["y"], ["x"], ["z"])),
    P(["z"], ["x"]),
  ]));
  const latex = expressionLatex(expression);
  assert.equal(latex,
    "\\sum_{\\mathrm{z}^{\\prime}}\\!\\left[\\left[\\sum_{\\mathrm{x}^{\\prime}}\\!\\left[P\\!\\left(\\mathrm{y} \\mid \\operatorname{do}\\!\\left(\\mathrm{x}^{\\prime}\\right), \\mathrm{z}^{\\prime}\\right)\\right] \\cdot P\\!\\left(\\mathrm{z}^{\\prime} \\mid \\operatorname{do}\\!\\left(\\mathrm{x}\\right)\\right)\\right]\\right]");
  assert.doesNotMatch(latex, /[′'Σ]/u);
});

test("marginalization collapse removes the dummy notation and retains original graph IDs", () => {
  const initial = P(["y"], ["x"]);
  const snapshot = structuredClone(initial);
  const expanded = applyMarginalization(graph, initial, [initial.id], "expand", ["z", "w"]);
  assert.equal(formatExpression(expanded.expression), "Σ_{z′, w′} [P(y, z′, w′ | do(x))]");
  assert.deepEqual(expanded.expression.variables, ["z", "w"]);
  assert.deepEqual(expanded.certificate.sets.Z, ["z", "w"]);
  const collapsed = applyMarginalization(graph, expanded.expression, [expanded.expression.id], "collapse", ["z", "w"]);
  assert.equal(formatExpression(collapsed.expression), "P(y | do(x))");
  assert.deepEqual(collapsed.expression, initial);
  assert.deepEqual(initial, snapshot);
  const history = [{ expression: initial, certificate: null }];
  append(history, expanded);
  append(history, collapsed);
  assert.equal(buildProof(documentFrom(history)).sections[0].blocks[4].latex,
    "\\text{(3) Marginalize, with}\\quad Z = \\left\\{\\mathrm{Z}, \\mathrm{W}\\right\\}");
});

test("saved state preserves original identities while restoring primed expression notation", () => {
  const history = scopedHistory();
  const document = documentFrom(history);
  const saved = serializeState(document, []);
  assert.doesNotMatch(saved, /′|\\prime/u);
  const restored = parseState(saved);
  assert.deepEqual(restored.document, document);
  assert.equal(formatExpression(restored.document.current),
    "Σ_{z′} [(P(y | do(x, z′)) · P(z′ | do(x)))]");
  assert.equal(exportMarkdown(restored.document), exportMarkdown(document));
});

test("proof captions name variables while expressions distinguish bound and fixed values", () => {
  const document = documentFrom(scopedHistory());
  const blocks = buildProof(document).sections[0].blocks;
  assert.equal(blocks[2].latex,
    "\\text{(2) Marginalize, with}\\quad Z = \\left\\{\\mathrm{Z}\\right\\}");
  assert.equal(blocks[4].latex,
    "\\text{(3) Chain rule, with}\\quad Y = \\left\\{\\mathrm{Y}\\right\\},\\quad Z = \\left\\{\\mathrm{Z}\\right\\}");
  assert.equal(blocks[6].latex,
    "\\text{(4) Rule 2, with}\\quad X = \\left\\{\\mathrm{X}\\right\\},\\quad Z = \\left\\{\\mathrm{Z}\\right\\},\\quad Y = \\left\\{\\mathrm{Y}\\right\\},\\quad W = \\varnothing");
  for (const output of [exportMarkdown(document), exportLatex(document)]) {
    assert.match(output, /\\sum_\{\\mathrm\{z\}\^\{\\prime\}\}/u);
    assert.doesNotMatch(output, /[′']/u);
  }
});

test("saved and reversed lemma proofs retain variable sets and bound expression values", () => {
  const history = scopedHistory();
  for (const reverse of [false, true]) {
    const lemma = createLemma(graph, history, reverse ? 3 : 0, reverse ? 0 : 3, {
      id: reverse ? "reverse-lemma" : "forward-lemma", name: "Lemma 1",
    });
    const initial = P(["y"], ["x"]);
    const main = [{ expression: initial, certificate: null }];
    append(main, applyLemma(graph, initial, [initial.id], lemma, reverse ? "reverse" : "forward"));
    const restored = parseState(serializeState(documentFrom(main), [lemma]));
    const section = buildProof(restored.document, restored.lemmas).sections[0];
    const headers = section.blocks.filter((block) => block.keepWithNext).map((block) => block.latex);
    assert.match(headers[reverse ? 1 : 3], /Rule 2, with/u);
    for (const header of headers.slice(1)) {
      assert.match(header, /Z = \\left\\\{\\mathrm\{Z\}\\right\\\}/u);
      assert.doesNotMatch(header, /\\prime\}\^|′/u);
    }
    assert.equal(section.blocks[1].latex, expressionLatex(reverse ? history.at(-1).expression : history[0].expression));
    assert.equal(section.blocks.at(-1).latex, "= " + expressionLatex(reverse ? history[0].expression : history.at(-1).expression));
  }
});
