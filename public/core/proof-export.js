import { sameExpression, replayHistory } from "./lemmas.js";
import { validateGraph } from "./graph.js";

const GREEK = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta",
  ε: "\\varepsilon", ϵ: "\\epsilon", ζ: "\\zeta", η: "\\eta",
  θ: "\\theta", ϑ: "\\vartheta", ι: "\\iota", κ: "\\kappa",
  λ: "\\lambda", μ: "\\mu", ν: "\\nu", ξ: "\\xi", ο: "o",
  π: "\\pi", ϖ: "\\varpi", ρ: "\\rho", ϱ: "\\varrho",
  σ: "\\sigma", ς: "\\varsigma", τ: "\\tau", υ: "\\upsilon",
  φ: "\\varphi", ϕ: "\\phi", χ: "\\chi", ψ: "\\psi", ω: "\\omega",
  Α: "\\mathrm{A}", Β: "\\mathrm{B}", Γ: "\\Gamma", Δ: "\\Delta",
  Ε: "\\mathrm{E}", Ζ: "\\mathrm{Z}", Η: "\\mathrm{H}", Θ: "\\Theta",
  Ι: "\\mathrm{I}", Κ: "\\mathrm{K}", Λ: "\\Lambda", Μ: "\\mathrm{M}",
  Ν: "\\mathrm{N}", Ξ: "\\Xi", Ο: "\\mathrm{O}", Π: "\\Pi",
  Ρ: "\\mathrm{P}", Σ: "\\Sigma", Τ: "\\mathrm{T}", Υ: "\\Upsilon",
  Φ: "\\Phi", Χ: "\\mathrm{X}", Ψ: "\\Psi", Ω: "\\Omega",
};

const TEX_ESCAPES = {
  "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "$": "\\$",
  "&": "\\&", "#": "\\#", "_": "\\_", "%": "\\%",
  "~": "\\textasciitilde{}", "^": "\\textasciicircum{}",
};

function texText(value) {
  return String(value).replace(/[\\{}$&#_%~^]/gu, (character) => TEX_ESCAPES[character]);
}

/** Identifiers are labels, not executable TeX or implicit subscripts.
 * Greek letters use commands. Other Unicode letters remain inside \text,
 * preserving their spelling for MathJax and Unicode-capable TeX engines.
 */
export function labelLatex(value) {
  const label = String(value);
  let output = "", run = "", kind = null;
  function flush() {
    if (run) output += (kind === "ascii" ? "\\mathrm{" : "\\text{") + texText(run) + "}";
    run = "";
  }
  for (const character of label) {
    if (Object.hasOwn(GREEK, character)) {
      flush();
      output += GREEK[character] + "{}";
      kind = null;
    } else {
      const nextKind = /^[A-Za-z0-9_]$/u.test(character) ? "ascii" : "unicode";
      if (nextKind !== kind) flush();
      kind = nextKind;
      run += character;
    }
  }
  flush();
  return output || "\\text{}";
}

const listLatex = (ids, label) => ids.map((id) => labelLatex(label(id))).join(", ");
const setLatex = (ids, label) =>
  ids.length ? "\\left\\{" + listLatex(ids, label) + "\\right\\}" : "\\varnothing";

/** Every sum and product keeps explicit scope, including a sum beside a factor. */
export function expressionLatex(expression, label = (id) => id) {
  if (expression.type === "probability") {
    const probability = expression.probability;
    const conditions = [];
    if (probability.intervention.length) {
      conditions.push("\\operatorname{do}\\!\\left(" + listLatex(probability.intervention, label) + "\\right)");
    }
    if (probability.observation.length) conditions.push(listLatex(probability.observation, label));
    return "P\\!\\left(" + listLatex(probability.outcome, label)
      + (conditions.length ? " \\mid " + conditions.join(", ") : "") + "\\right)";
  }
  if (expression.type === "sum") {
    return "\\sum_{" + listLatex(expression.variables, label) + "}\\!\\left["
      + expressionLatex(expression.body, label) + "\\right]";
  }
  if (expression.type === "product") {
    return "\\left[" + expression.factors.map((factor) => expressionLatex(factor, label)).join(" \\cdot ") + "\\right]";
  }
  throw new Error("Cannot export an unknown expression type.");
}

const math = (latex) => ({ type: "math", latex });

function operationLabel(certificate, lemmaNames) {
  if (certificate.kind === "do-calculus") {
    if (![1, 2, 3].includes(certificate.rule)) throw new Error("Cannot export an unknown do-calculus rule.");
    return "Rule " + certificate.rule;
  }
  if (certificate.kind === "marginalize") return "Marginalize";
  if (certificate.kind === "chain") return "Chain rule";
  if (certificate.kind === "lemma") {
    const name = lemmaNames.get(certificate.lemmaId);
    if (!name) throw new Error("A lemma referenced by this proof is unavailable.");
    return name;
  }
  throw new Error("Cannot export an unknown proof operation.");
}

function relevantSetNames(certificate) {
  if (certificate.kind === "do-calculus") return ["X", "Z", "Y", "W"];
  if (certificate.kind === "marginalize") return ["Z"];
  if (certificate.kind === "chain") return ["Y", "Z"];
  return [];
}

function operationLine(number, certificate, label, lemmaNames) {
  const operation = texText(operationLabel(certificate, lemmaNames));
  const names = relevantSetNames(certificate);
  const sets = names.map((name) => `${name} = ${setLatex(certificate.sets[name], label)}`).join(",\\quad ");
  return `\\text{(${number}) ${operation}${sets ? ", with" : ""}}${sets ? `\\quad ${sets}` : ""}`;
}

/** Display an already checked history in either direction. A reversible step
 * uses the same rule and sets in both directions; its original target IDs are
 * used only during validation, never as targets in a fabricated reverse proof.
 */
function historyBlocks(history, label, lemmaNames, reverse = false) {
  const blocks = [];
  const displayed = reverse ? history.slice().reverse() : history;
  displayed.forEach((step, index) => {
    if (index === 0) {
      blocks.push({ ...math("\\text{(1) Given:}"), keepWithNext: true });
      blocks.push(math(expressionLatex(step.expression, label)));
      return;
    }
    const c = reverse ? history[history.length - index].certificate : step.certificate;
    blocks.push({ ...math(operationLine(index + 1, c, label, lemmaNames)), keepWithNext: true });
    blocks.push(math("= " + expressionLatex(step.expression, label)));
  });
  return blocks;
}

function usedLemmas(history, savedLemmas) {
  const byId = new Map();
  savedLemmas.forEach((lemma) => {
    if (byId.has(lemma.id)) throw new Error("Saved lemma IDs must be unique.");
    byId.set(lemma.id, lemma);
  });
  const ordered = [], complete = new Set(), active = new Set();
  function visit(id) {
    if (complete.has(id)) return;
    if (active.has(id)) throw new Error("Saved lemmas contain a circular dependency.");
    const lemma = byId.get(id);
    if (!lemma) throw new Error("A lemma referenced by this proof is unavailable.");
    active.add(id);
    for (const step of lemma.proof?.history?.slice(1) || []) {
      if (step.certificate?.kind === "lemma") visit(step.certificate.lemmaId);
    }
    active.delete(id);
    complete.add(id);
    ordered.push(lemma);
  }
  for (const step of history.slice(1)) {
    if (step.certificate?.kind === "lemma") visit(step.certificate.lemmaId);
  }
  return ordered;
}

/** Renderer-independent compact proof model. Only active history is exported;
 * redo states and unrelated library entries never enter the model. The export
 * is detached, deterministic, and contains no HTML or executable markup.
 */
export function buildProof(documentState, savedLemmas = []) {
  const history = documentState?.history;
  if (!Array.isArray(history) || !history.length || !documentState.current) {
    throw new Error("Start a derivation before exporting a proof.");
  }
  if (!sameExpression(documentState.current, history.at(-1).expression)) {
    throw new Error("The current expression does not match the last active proof line.");
  }
  const ordered = usedLemmas(history, savedLemmas);
  const names = new Map(ordered.map((lemma) => [lemma.id, lemma.name]));
  validateGraph(documentState.graph);
  const currentLabels = new Map(documentState.graph.nodes.map((node) => [node.id, node.label]));
  const resolver = (graph, savedLabels = {}) => {
    const local = new Map(graph.nodes.map((node) => [node.id, node.label]));
    return (id) => currentLabels.get(id) ?? local.get(id) ?? savedLabels[id] ?? id;
  };
  const sections = [];
  const verifiedLemmas = [];
  ordered.forEach((lemma) => {
    const proof = lemma.proof;
    if (!proof) throw new Error("A saved lemma's proof is missing; it cannot be exported.");
    if (!Array.isArray(proof.history) || proof.history.length < 2
        || ![proof.l1, proof.l2].every((line) => Number.isInteger(line) && line >= 0 && line < proof.history.length)
        || Math.min(proof.l1, proof.l2) !== 0 || Math.max(proof.l1, proof.l2) !== proof.history.length - 1
        || !sameExpression(proof.history[proof.l1].expression, lemma.left)
        || !sameExpression(proof.history[proof.l2].expression, lemma.right)) {
      throw new Error("A saved lemma's proof does not match its recorded equality.");
    }
    validateGraph(proof.graph);
    // Replay the original snapshots before choosing a display direction. Derive
    // inherited checks from proofs rather than trusting cached lemma metadata.
    const { checks } = replayHistory(proof.graph, proof.history, verifiedLemmas);
    verifiedLemmas.push({ ...lemma, checks });
    const label = resolver(proof.graph, lemma.labels);
    sections.push({
      title: names.get(lemma.id),
      blocks: historyBlocks(proof.history, label, names, proof.l1 > proof.l2),
    });
  });
  replayHistory(documentState.graph, history, verifiedLemmas);
  const label = resolver(documentState.graph);
  sections.push({ title: ordered.length ? "Proof" : "", blocks: historyBlocks(history, label, names) });
  return { title: "", sections };
}

function markdownText(value) {
  return String(value).replace(/([\\`*_[\]<>#|~$])/gu, "\\$1").replace(/\r?\n/gu, " ");
}

export function exportMarkdown(documentState, savedLemmas = []) {
  const proof = buildProof(documentState, savedLemmas);
  const chunks = [];
  if (proof.title) chunks.push("# " + markdownText(proof.title));
  for (const section of proof.sections) {
    if (section.title) chunks.push("## " + markdownText(section.title));
    for (const block of section.blocks) {
      chunks.push(block.type === "math" ? "$$\n" + block.latex + "\n$$" : markdownText(block.text));
    }
  }
  return chunks.join("\n\n") + "\n";
}

/** Standalone source: XeLaTeX/LuaLaTeX preserves non-ASCII variable names.
 * Choose a document font covering those labels when using uncommon scripts.
 */
export function exportLatex(documentState, savedLemmas = []) {
  const proof = buildProof(documentState, savedLemmas);
  const lines = [
    "\\documentclass[11pt]{article}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage{fontspec}",
    "\\usepackage{amsmath,amssymb}",
    "\\pagestyle{empty}",
    "\\setlength{\\parindent}{0pt}",
    "\\setlength{\\parskip}{0.6em}",
    "\\begin{document}",
  ];
  for (const section of proof.sections) {
    if (section.title) lines.push("\\subsection*{" + texText(section.title) + "}");
    for (let index = 0; index < section.blocks.length; index++) {
      const block = section.blocks[index];
      if (block.keepWithNext) {
        const expression = section.blocks[++index];
        lines.push("\\begin{gather*}\n" + block.latex + " \\\\\n" + expression.latex + "\n\\end{gather*}");
      } else {
        lines.push(block.type === "math" ? "\\[\n" + block.latex + "\n\\]" : texText(block.text) + "\\par");
      }
    }
  }
  lines.push("\\end{document}", "");
  return lines.join("\n");
}
