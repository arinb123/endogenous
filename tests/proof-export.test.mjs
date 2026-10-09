import test from "node:test";
import assert from "node:assert/strict";
import { buildProof, exportMarkdown, exportLatex, expressionLatex, labelLatex } from "../public/core/proof-export.js";
import { probabilityExpression, productExpression, sumExpression } from "../public/core/expression.js";
import { applyDoCalculus, applyMarginalization, applyChainRule } from "../public/core/algebra.js";
import { createLemma, applyLemma } from "../public/core/lemmas.js";

const graph = {
  nodes: ["x", "y", "z", "w"].map((id) => ({ id, label: id })),
  edges: [
    { id: "xz", source: "x", target: "z", type: "directed" },
    { id: "xy", source: "x", target: "y", type: "bidirected" },
  ],
};
const P = (outcome, intervention = [], observation = []) =>
  probabilityExpression({ outcome, intervention, observation });
const initial = () => P(["y"], ["x"], ["z"]);
const sets = { X: ["x"], Y: ["y"], Z: ["z"], W: [] };

function stateFrom(history, assumptions = graph) {
  return {
    graph: structuredClone(assumptions),
    initial: structuredClone(history[0].expression.probability),
    current: structuredClone(history.at(-1).expression),
    history: structuredClone(history),
  };
}

function step(history, result) {
  history.push({ expression: result.expression, certificate: result.certificate });
  return result.expression;
}

function baseHistory() {
  const first = initial();
  const history = [{ expression: first, certificate: null }];
  step(history, applyDoCalculus(graph, first, [first.id], 1, "delete", sets));
  return history;
}

function saved(history, l1, l2, id, name, dependencies = []) {
  return createLemma(graph, history, l1, l2, { id, name }, dependencies);
}

function lemmaFixture() {
  const firstHistory = baseHistory();
  const first = saved(firstHistory, 0, 1, "lemma-first", "Remove z");
  const root = initial();
  const secondHistory = [{ expression: root, certificate: null }];
  const middle = step(secondHistory, applyLemma(graph, root, [root.id], first, "forward"));
  step(secondHistory, applyMarginalization(graph, middle, [middle.id], "expand", ["w"]));
  const second = saved(secondHistory, 0, 2, "lemma-second", "Expand after removal", [first]);
  const main = initial();
  const history = [{ expression: main, certificate: null }];
  step(history, applyLemma(graph, main, [main.id], second, "forward"));
  const unused = saved(firstHistory, 0, 1, "lemma-unused", "UNRELATED LIBRARY ENTRY");
  return { first, second, unused, state: stateFrom(history) };
}

const allMath = (model) => model.sections.flatMap((section) => section.blocks).filter((block) => block.type === "math").map((block) => block.latex);
const numbered = (section) => section.blocks.filter((block) => block.type === "math" && block.latex.startsWith("\\text{("));

test("probabilities, nested sums, and products export explicit exact scopes", () => {
  const factor = P(["y"], ["x"], ["z"]);
  const scoped = productExpression([sumExpression(["z", "w"], factor), P(["z"])]);
  const latex = expressionLatex(scoped);
  assert.equal(latex,
    "\\left[\\sum_{\\mathrm{z}, \\mathrm{w}}\\!\\left[P\\!\\left(\\mathrm{y} \\mid \\operatorname{do}\\!\\left(\\mathrm{x}\\right), \\mathrm{z}\\right)\\right] \\cdot P\\!\\left(\\mathrm{z}\\right)\\right]");
  assert.doesNotMatch(latex, /[Σ∑·→↔⊥⫫∅]/u);
});

test("labels escape underscores, convert Greek to commands, and preserve other Unicode as text", () => {
  assert.equal(labelLatex("lung_cancer"), "\\mathrm{lung\\_cancer}");
  assert.equal(labelLatex("α_β"), "\\alpha{}\\mathrm{\\_}\\beta{}");
  assert.equal(labelLatex("Σ"), "\\Sigma{}");
  assert.equal(labelLatex("出生"), "\\text{出生}");
  assert.equal(labelLatex("café"), "\\mathrm{caf}\\text{é}");
  assert.match(labelLatex("\\input{secret}"), /\\textbackslash\{\}/u);
  assert.doesNotMatch(labelLatex("\\input{secret}"), /\\input\{/u);
});

test("main proof uses only the requested compact step format", () => {
  const history = baseHistory();
  let current = history.at(-1).expression;
  current = step(history, applyMarginalization(graph, current, [current.id], "expand", ["z"]));
  const selected = current.body;
  step(history, applyChainRule(graph, current, [selected.id], "split", ["y"], ["z"]));
  const model = buildProof(stateFrom(history));
  assert.deepEqual(model.sections.map((section) => section.title), [""]);
  const proof = model.sections.at(-1);
  assert.equal(numbered(proof).length, 4);
  assert.ok(numbered(proof).every((block) => block.keepWithNext === true));
  const formulas = allMath(model).join("\n");
  assert.match(formulas, /\\text\{\(1\) Given:\}/u);
  assert.match(formulas, /\\text\{\(2\) Rule 1, with\}/u);
  assert.match(formulas, /\\text\{\(3\) Marginalize, with\}/u);
  assert.match(formulas, /\\text\{\(4\) Chain rule, with\}/u);
  assert.doesNotMatch(formulas, /m-separation|Incoming|Outgoing|Applied to|Probability identity|Graph assumptions/u);
  assert.equal(proof.blocks.at(-1).latex, "= " + expressionLatex(history.at(-1).expression));
});

test("only referenced lemmas appear first and transitive dependencies precede dependents", () => {
  const { first, second, unused, state } = lemmaFixture();
  const model = buildProof(state, [unused, second, first]);
  assert.deepEqual(model.sections.map((section) => section.title), [
    "Remove z", "Expand after removal", "Proof",
  ]);
  assert.equal(numbered(model.sections[0]).length, 2);
  assert.equal(numbered(model.sections[1]).length, 3);
  const formulas = allMath(model).join("\n");
  assert.match(formulas, /\\text\{\(2\) Rule 1, with\}/u);
  assert.match(formulas, /\\text\{\(2\) Remove z\}/u);
  assert.match(formulas, /\\text\{\(3\) Marginalize, with\}/u);
  assert.doesNotMatch(formulas, /Inherited graph condition|Graph assumptions|source lines/u);
  assert.doesNotMatch(JSON.stringify(model), /UNRELATED LIBRARY ENTRY/u);
});

test("export preserves a saved lemma's number when other library entries are unused", () => {
  const { first } = lemmaFixture();
  first.name = "Lemma 3";
  const root = initial(), history = [{ expression: root, certificate: null }];
  step(history, applyLemma(graph, root, [root.id], first, "forward"));
  const model = buildProof(stateFrom(history), [first]);
  assert.deepEqual(model.sections.map((section) => section.title), ["Lemma 3", "Proof"]);
  assert.equal(model.sections.at(-1).blocks[2].latex, "\\text{(2) Lemma 3}");
  assert.doesNotMatch(JSON.stringify(model), /Lemma 1:|Lemma 3: Lemma 3/u);
});

test("lemma names and conditions come from the library, not certificate copies", () => {
  const { first, second, state } = lemmaFixture();
  state.history[1].certificate.name = "STALE OR SPOOFED NAME";
  state.history[1].certificate.checks = [];
  second.name = "Current saved name";
  const model = buildProof(state, [first, second]);
  assert.match(JSON.stringify(model), /Current saved name/u);
  assert.doesNotMatch(JSON.stringify(model), /Inherited graph condition/u);
  assert.doesNotMatch(JSON.stringify(model), /STALE OR SPOOFED NAME/u);
});

test("reversed lemma endpoints export from the selected left side", () => {
  const history = baseHistory();
  const source = history.at(-1).expression;
  step(history, applyMarginalization(graph, source, [source.id], "expand", ["w"]));
  const lemma = saved(history, 2, 1, "reverse-source", "Collapse w");
  const main = P(["y"], ["x"]);
  const mainHistory = [{ expression: main, certificate: null }];
  step(mainHistory, applyLemma(graph, main, [main.id], lemma, "reverse"));
  const model = buildProof(stateFrom(mainHistory), [lemma]);
  assert.equal(model.sections[0].blocks[0].latex, "\\text{(1) Given:}");
  assert.match(model.sections[0].blocks[2].latex, /\\text\{\(2\) Marginalize, with\}/u);
  assert.match(model.sections[0].blocks.at(-1).latex, /^= P/u);
  assert.match(model.sections.at(-1).blocks[2].latex, /\\text\{\(2\) Collapse w\}/u);
});

test("reversed lemma display still verifies every original transition", () => {
  const history = baseHistory();
  const source = history.at(-1).expression;
  step(history, applyMarginalization(graph, source, [source.id], "expand", ["w"]));
  const lemma = saved(history, 2, 0, "reverse-tampered", "Reverse derivation");
  const main = initial(), mainHistory = [{ expression: main, certificate: null }];
  step(mainHistory, applyLemma(graph, main, [main.id], lemma, "reverse"));
  // Preserve both recorded endpoints, but corrupt an intermediate equality.
  lemma.proof.history[1].expression.probability.outcome = ["w"];
  assert.throws(() => buildProof(stateFrom(mainHistory), [lemma]), /checked justification/u);
});

test("active history after reverting exports no discarded continuation or its lemmas", () => {
  const { first, second, unused, state } = lemmaFixture();
  state.current = structuredClone(state.history[0].expression);
  state.history = state.history.slice(0, 1);
  const model = buildProof(state, [first, second, unused]);
  assert.deepEqual(model.sections.map((section) => section.title), [""]);
  assert.equal(numbered(model.sections.at(-1)).length, 1);
  assert.doesNotMatch(JSON.stringify(model), /Remove z|Expand after removal/u);
});

test("saved lemmas without a supporting proof cannot export a self-citing equality", () => {
  const { first } = lemmaFixture();
  delete first.proof;
  const root = initial(), history = [{ expression: root, certificate: null }];
  step(history, applyLemma(graph, root, [root.id], first, "forward"));
  assert.throws(() => buildProof(stateFrom(history), [first]), /proof/u);
});

test("export rejects a result inconsistent with its rule and an invalid algebra direction", () => {
  const history = baseHistory();
  history[1].expression.probability.outcome = ["w"];
  assert.throws(() => buildProof(stateFrom(history)), /checked justification/u);

  const root = P(["y"], ["x"]), algebraHistory = [{ expression: root, certificate: null }];
  step(algebraHistory, applyMarginalization(graph, root, [root.id], "expand", ["z"]));
  algebraHistory[1].certificate.direction = "invalid";
  assert.throws(() => buildProof(stateFrom(algebraHistory)), /Unknown marginalization direction/u);
});

test("rule 2 and rule 3 export only their rule name and relevant sets", () => {
  const independent = { nodes: graph.nodes, edges: [] };
  const root = P(["y"], ["x", "z"], ["w"]);
  const history = [{ expression: root, certificate: null }];
  step(history, applyDoCalculus(independent, root, [root.id], 2, "to-observation", { X: ["x"], Y: ["y"], Z: ["z"], W: ["w"] }));
  let model = buildProof(stateFrom(history, independent));
  assert.match(allMath(model).join("\n"), /\\text\{\(2\) Rule 2, with\}/u);
  const action = P(["y"], ["x", "z"], ["w"]);
  const thirdHistory = [{ expression: action, certificate: null }];
  step(thirdHistory, applyDoCalculus(independent, action, [action.id], 3, "delete", { X: ["x"], Y: ["y"], Z: ["z"], W: ["w"] }));
  model = buildProof(stateFrom(thirdHistory, independent));
  const formulas = allMath(model).join("\n");
  assert.match(formulas, /\\text\{\(2\) Rule 3, with\}/u);
  assert.doesNotMatch(formulas, /m-separation|Incoming|Outgoing|\\underline|\\overline/u);
  assert.doesNotMatch(formulas, /[Σ∑·→↔⊥⫫∅∖]/u);
});

test("renamed variables use current labels consistently in lemmas and the main proof", () => {
  const { first, second, state } = lemmaFixture();
  state.graph.nodes.find((node) => node.id === "y").label = "outcome_name";
  const model = buildProof(state, [first, second]);
  const formulas = allMath(model).join("\n");
  assert.match(formulas, /\\mathrm\{outcome\\_name\}/u);
  assert.doesNotMatch(formulas, /\\mathrm\{y\}/u);
});

test("Markdown emits display math, escapes names, and standalone LaTeX is compilable source", () => {
  const { first, second, state } = lemmaFixture();
  second.name = "A_lemma #1 $cash$ \\input{bad} <b>";
  const markdown = exportMarkdown(state, [first, second]);
  const latex = exportLatex(state, [first, second]);
  assert.match(markdown, /^## Remove z/u);
  assert.match(markdown, /\$\$\n\\text\{\(1\) Given:\}/u);
  assert.match(markdown, /A\\_lemma \\#1 \\\$cash\\\$/u);
  assert.match(latex, /\\documentclass\[11pt\]\{article\}/u);
  assert.match(latex, /\\usepackage\{fontspec\}/u);
  assert.match(latex, /\\pagestyle\{empty\}/u);
  assert.match(latex, /\\begin\{gather\*\}\n\\text\{\(1\) Given:\}/u);
  assert.match(latex, /A\\_lemma \\#1 \\\$cash\\\$/u);
  assert.doesNotMatch(latex, /\\input\{bad\}/u);
  const finalExpression = "= " + expressionLatex(state.current);
  assert.ok(markdown.endsWith(finalExpression + "\n$$\n"), "Markdown ends at the final equation");
  assert.ok(latex.endsWith(finalExpression + "\n\\end{gather*}\n\\end{document}\n"), "LaTeX has only closing environments after the final equation");
  assert.doesNotMatch(markdown, /Graph assumptions|m-separation|Probability identity|Inherited graph condition/u);
  assert.doesNotMatch(latex, /Graph assumptions|m-separation|Probability identity|Inherited graph condition/u);
  assert.ok(/^[\x00-\x7F]*$/u.test(latex), "ASCII labels produce fully ASCII TeX");
});

test("export is deterministic and neither document nor saved lemma metadata is mutated", () => {
  const { first, second, state } = lemmaFixture();
  const saved = [first, second], beforeState = structuredClone(state), beforeSaved = structuredClone(saved);
  const one = buildProof(state, saved), two = buildProof(state, saved);
  assert.deepEqual(one, two);
  one.sections[0].blocks[0].latex = "changed model";
  assert.deepEqual(state, beforeState);
  assert.deepEqual(saved, beforeSaved);
  assert.notEqual(two.sections[0].blocks[0].latex, "changed model");
});

test("missing and cyclic dependencies, inconsistent proof metadata, and stale active state fail explicitly", () => {
  const { first, second, state } = lemmaFixture();
  assert.throws(() => buildProof(state, [second]), /unavailable/u);
  const cycleFirst = structuredClone(first);
  cycleFirst.proof.history[1].certificate = { kind: "lemma", lemmaId: second.id };
  assert.throws(() => buildProof(state, [cycleFirst, second]), /circular/u);
  const badProof = structuredClone(first);
  badProof.proof.l1 = 99;
  assert.throws(() => buildProof(state, [badProof, second]), /proof does not match/u);
  const stale = structuredClone(state);
  stale.current = initial();
  assert.throws(() => buildProof(stale, [first, second]), /last active proof line/u);
  assert.throws(() => buildProof({ history: [], current: null }, []), /Start a derivation/u);
});

test("inherited graph conditions are rechecked for the graph of each use", () => {
  const { first, second, state } = lemmaFixture();
  // Export must derive obligations from the stored proofs, not cached copies.
  first.checks = [];
  second.checks = [];
  second.proof.history[1].certificate.checks = [];
  state.history[1].certificate.checks = [];
  state.graph.edges.push({ id: "zy", source: "z", target: "y", type: "directed" });
  assert.throws(() => buildProof(state, [first, second]), /not m-separated/u);
});
