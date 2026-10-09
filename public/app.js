import { validateGraph } from "./core/graph.js";
import {
  parseProbability,
  formatProbability,
  validateLabel,
} from "./core/probability.js";
import { RULES } from "./core/calculus.js";
import {
  probabilityExpression,
  locateExpression,
  formatExpression,
} from "./core/expression.js";
import {
  ALGEBRA,
  applyMarginalization,
  applyChainRule,
  applyDoCalculus,
} from "./core/algebra.js";
import { createLemma, applyLemma } from "./core/lemmas.js";
import { DocumentHistory } from "./core/document-history.js";
import { serializeState, parseState, MAX_STATE_BYTES } from "./core/state.js";
import { exportMarkdown, exportLatex } from "./core/proof-export.js";
import { renderLemmaPanel } from "./lemma-panel.js";
import { renderExpression } from "./expression-view.js";
import { renderAlgebraPanels } from "./algebra-panel.js";
import { renderGraph, graphPoint, clampPosition } from "./graph-view.js";

// Document state is independent of transient tool/checkbox/selection state.
// Every mathematical operation is delegated to the pure modules in core/.
let documentState = {
  graph: { nodes: [], edges: [] },
  initial: null,
  current: null,
  history: [],
};
let documentHistory = new DocumentHistory();
// A saved equality outlives equation restarts and document undo/redo.
const savedLemmas = [];
const lemmaPanel = {
  l1: 0,
  l2: null,
  lemmaId: "",
  direction: "forward",
  message: "",
  error: false,
};
const panels = Object.fromEntries(
  [1, 2, 3].map((rule) => [
    rule,
    {
      direction: RULES[rule].directions[0][0],
      sets: { X: [], Z: [], Y: [], W: [] },
      message: "",
      error: false,
    },
  ]),
);
const algebraPanels = {
  marginalize: {
    direction: "expand",
    sets: { Z: [] },
    message: "",
    error: false,
  },
  chain: {
    direction: "split",
    sets: { Y: [], Z: [] },
    message: "",
    error: false,
  },
};
let expressionSelection = [];
let selected = null,
  tool = "select",
  edgeSource = null,
  drag = null,
  renameId = null;
let lastNodeClick = null;
const $ = (selector) => document.querySelector(selector);
const label = (id) =>
  documentState.graph.nodes.find((node) => node.id === id)?.label || id;
const format = (expression) => formatExpression(expression, label);
const groupText = (ids) =>
  ids.length ? `{${ids.map(label).join(", ")}}` : "∅";
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

function checkpoint() {
  documentHistory.checkpoint(documentState);
}

function fileMessage(message, error = false) {
  $("#file-status").textContent = message;
  $("#file-status").classList.toggle("error", error);
}

function downloadFile(contents, filename, type) {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = make("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start reading before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function saveState() {
  try {
    downloadFile(serializeState(documentState, savedLemmas), "endogenous-state.json", "application/json");
    fileMessage("State saved, including graph, derivation, current expression, and lemmas.");
  } catch (error) {
    fileMessage(error.message, true);
  }
}

async function importState(file) {
  if (!file) return;
  try {
    if (file.size > MAX_STATE_BYTES) throw new Error("This state file is too large (maximum 10 MB).");
    const restored = parseState(await file.text());
    // Validate everything before replacing any live state. Undo history belongs
    // to the previous document, so it must not mix with the imported library.
    documentHistory = new DocumentHistory();
    savedLemmas.splice(0, savedLemmas.length, ...restored.lemmas);
    lemmaPanel.l1 = 0;
    lemmaPanel.lemmaId = "";
    algebraPanels.marginalize.sets = { Z: [] };
    algebraPanels.chain.sets = { Y: [], Z: [] };
    for (const panel of Object.values(panels)) panel.sets = { X: [], Z: [], Y: [], W: [] };
    $("#pair-selection").checked = false;
    lastNodeClick = null;
    restoreDocument(restored.document);
    setTool("select");
    $("#query-dialog").close();
    fileMessage("State imported. Graph, derivation, current expression, and lemmas restored.");
  } catch (error) {
    if ($("#query-dialog").open) $("#query-error").textContent = error.message;
    fileMessage(`Import failed: ${error.message}`, true);
  } finally {
    $("#state-file").value = "";
  }
}

async function exportProof(event) {
  event.preventDefault();
  const button = $("#download-proof");
  const format = $("#export-format").value;
  button.disabled = true;
  button.textContent = "Preparing proof…";
  $("#export-error").textContent = "";
  try {
    // Capture one immutable version even if the user continues editing while
    // the local PDF renderer is working.
    const state = serializeState(documentState, savedLemmas);
    if (format === "pdf") {
      const response = await fetch("/api/export/pdf", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: state,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "The local PDF export failed. Restart the app server and try again.");
      }
      downloadFile(await response.blob(), "endogenous-proof.pdf", "application/pdf");
    } else {
      const snapshot = JSON.parse(state);
      const text = format === "md" ? exportMarkdown(snapshot.document, snapshot.lemmas) : exportLatex(snapshot.document, snapshot.lemmas);
      downloadFile(text, `endogenous-proof.${format}`, format === "md" ? "text/markdown" : "application/x-tex");
    }
    $("#export-dialog").close();
    fileMessage(`Proof exported as ${format === "pdf" ? "PDF" : format === "md" ? "Markdown" : "LaTeX"}.`);
  } catch (error) {
    $("#export-error").textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Download proof";
  }
}

function clearRuleMessages() {
  lemmaPanel.message = "";
  lemmaPanel.error = false;
  for (const panel of [
    ...Object.values(panels),
    ...Object.values(algebraPanels),
  ]) {
    panel.message = "";
    panel.error = false;
  }
}

function graphMessage(message, error = false) {
  $("#graph-message").textContent = message;
  $("#graph-message").classList.toggle("error", error);
}

function resetDerivation() {
  lemmaPanel.l2 = null;
  documentState.current = documentState.initial
    ? probabilityExpression(documentState.initial)
    : null;
  expressionSelection = documentState.current ? [documentState.current.id] : [];
  documentState.history = documentState.initial
    ? [
        {
          expression: structuredClone(documentState.current),
          certificate: null,
        },
      ]
    : [];
  clearRuleMessages();
}

/** Validation happens before state/history mutation, so rejected edits are atomic. */
function changeGraph(graph, structural = true) {
  validateGraph(graph);
  drag = null;
  graph.nodes.forEach((node) => Object.assign(node, clampPosition(node)));
  checkpoint();
  const hadSteps = documentState.history.length > 1;
  documentState.graph = graph;
  if (structural) resetDerivation();
  render();
  if (structural && hadSteps)
    graphMessage(
      "Graph changed. The derivation has restarted from your initial probability. Undo restores the previous graph and derivation together.",
    );
  return structural && hadSteps;
}

function restoreDocument(next) {
  if (!next) return;
  drag = null;
  documentState = next;
  expressionSelection = documentState.current ? [documentState.current.id] : [];
  selected = null;
  edgeSource = null;
  lemmaPanel.l2 = null;
  prefillDoSetsForSelection();
  clearRuleMessages();
  render();
}

function undo() {
  restoreDocument(documentHistory.undo(documentState));
}

function redo() {
  restoreDocument(documentHistory.redo(documentState));
}

function revertTo() {
  const line = Number($("#revert-line").value);
  try {
    restoreDocument(documentHistory.revertTo(documentState, line));
    $("#derivation-message").textContent =
      `Reverted to line (${line}). Redo restores the later steps until you edit the graph or equation.`;
  } catch (error) {
    $("#derivation-message").textContent = error.message;
  }
}

function nextPosition(nodes) {
  const candidates = [
    [180, 180],
    [450, 410],
    [720, 180],
    [450, 180],
    [180, 410],
    [720, 410],
    [310, 295],
    [590, 295],
  ];
  const free = candidates.find(([x, y]) =>
    nodes.every((node) => Math.hypot(node.x - x, node.y - y) > 80),
  );
  if (free) return { x: free[0], y: free[1] };
  const index = nodes.length;
  return { x: 100 + ((index * 137) % 680), y: 100 + ((index * 97) % 420) };
}

function startProbability(text) {
  const parsed = parseProbability(text);
  const graph = structuredClone(documentState.graph);
  for (const name of [
    ...parsed.observation,
    ...parsed.intervention,
    ...parsed.outcome,
  ]) {
    if (!graph.nodes.some((node) => node.label === name))
      graph.nodes.push({
        id: crypto.randomUUID(),
        label: name,
        ...nextPosition(graph.nodes),
      });
  }
  const byName = new Map(graph.nodes.map((node) => [node.label, node.id]));
  graph.nodes.forEach((node) => Object.assign(node, clampPosition(node)));
  const probability = Object.fromEntries(
    Object.entries(parsed).map(([key, values]) => [
      key,
      values.map((name) => byName.get(name)),
    ]),
  );
  checkpoint();
  const expression = probabilityExpression(probability);
  documentState = {
    graph,
    initial: probability,
    current: expression,
    history: [{ expression: structuredClone(expression), certificate: null }],
  };
  expressionSelection = [expression.id];
  lemmaPanel.l1 = 0;
  lemmaPanel.l2 = null;
  algebraPanels.marginalize.sets = { Z: [] };
  algebraPanels.chain.sets = { Y: [], Z: [] };
  $("#pair-selection").checked = false;
  for (const panel of Object.values(panels))
    panel.sets = {
      X: [...probability.intervention],
      Z: [],
      Y: [...probability.outcome],
      W: [],
    };
  clearRuleMessages();
  selected = null;
  edgeSource = null;
  $("#query-dialog").close();
  render();
  graphMessage(
    "Probability defined. Add edges to represent your causal assumptions, then choose the sets for a rule.",
  );
}

function openQuery() {
  $("#query-input").value = documentState.initial
    ? formatProbability(documentState.initial, label)
    : "";
  $("#query-error").textContent = "";
  $("#query-cancel").hidden = !documentState.initial;
  $("#query-form button[type=submit]").textContent = documentState.initial
    ? "Restart derivation"
    : "Begin";
  $("#query-dialog").showModal();
  $("#query-input").focus();
}

function openNode(id = null) {
  renameId = id;
  $("#node-title").textContent = id ? "Rename node" : "Add a node";
  $("#node-label").value = id ? label(id) : "";
  $("#node-error").textContent = "";
  $("#node-dialog").showModal();
  $("#node-label").focus();
}

function setTool(value) {
  tool = value;
  edgeSource = null;
  document
    .querySelectorAll("[data-tool]")
    .forEach((button) =>
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.tool === value),
      ),
    );
  renderCanvas();
  graphMessage(
    value === "select"
      ? "Drag nodes to arrange them. Select a node or edge to edit it."
      : value === "directed"
        ? "Choose the source node, then the target node. Escape cancels."
        : "Choose the two nodes to connect with a bidirected edge. Escape cancels.",
  );
}

function chooseNode(id) {
  selected = { kind: "node", id };
  if (tool !== "select") {
    if (!edgeSource) {
      edgeSource = id;
      graphMessage(`From ${label(id)}: choose the other node.`);
    } else {
      const graph = structuredClone(documentState.graph);
      graph.edges.push({
        id: crypto.randomUUID(),
        source: edgeSource,
        target: id,
        type: tool,
      });
      try {
        const reset = changeGraph(graph);
        edgeSource = null;
        if (!reset)
          graphMessage(
            "Edge added. Choose the next source, or switch to Select.",
          );
      } catch (error) {
        graphMessage(error.message, true);
      }
    }
  }
  renderCanvas();
  renderSelection();
}

function deleteSelection() {
  if (!selected) return;
  drag = null;
  const graph = structuredClone(documentState.graph);
  if (selected.kind === "node") {
    const used =
      documentState.initial &&
      Object.values(documentState.initial).flat().includes(selected.id);
    if (used) {
      graphMessage(
        "This node is part of the initial probability. Change the initial probability before deleting it.",
        true,
      );
      return;
    }
    graph.nodes = graph.nodes.filter((node) => node.id !== selected.id);
    graph.edges = graph.edges.filter(
      (edge) => edge.source !== selected.id && edge.target !== selected.id,
    );
  } else graph.edges = graph.edges.filter((edge) => edge.id !== selected.id);
  selected = null;
  edgeSource = null;
  changeGraph(graph);
}

function renderCanvas(graph = documentState.graph) {
  renderGraph($("#graph"), graph, selected, edgeSource);
}

function renderSelection() {
  const { graph } = documentState;
  const node =
    selected?.kind === "node" &&
    graph.nodes.find((node) => node.id === selected.id);
  const edge =
    selected?.kind === "edge" &&
    graph.edges.find((edge) => edge.id === selected.id);
  $("#rename").hidden = !node;
  $("#delete").disabled = !node && !edge;
  if (node) {
    const related = (type, end) =>
      graph.edges
        .filter(
          (edge) =>
            edge.type === type &&
            (end
              ? edge[end] === node.id
              : [edge.source, edge.target].includes(node.id)),
        )
        .map((edge) =>
          label(edge.source === node.id ? edge.target : edge.source),
        )
        .join(", ") || "none";
    $("#selection-info").textContent =
      `${node.label} · parents: ${related("directed", "target")} · children: ${related("directed", "source")} · bidirected: ${related("bidirected")}`;
  } else if (edge)
    $("#selection-info").textContent =
      `${label(edge.source)} ${edge.type === "directed" ? "→" : "↔"} ${label(edge.target)}`;
  else $("#selection-info").textContent = "Select a node to inspect it.";
}

const equations = {
  1: "P(y | do(x), z, w) = P(y | do(x), w)",
  2: "P(y | do(x), do(z), w) = P(y | do(x), z, w)",
  3: "P(y | do(x), do(z), w) = P(y | do(x), w)",
};

/** Commit only a fully checked rewrite, together with its entire expression. */
function recordStep(result) {
  checkpoint();
  documentState.current = result.expression;
  documentState.history.push({
    expression: structuredClone(result.expression),
    certificate: structuredClone(result.certificate),
  });
  expressionSelection = [...result.selection];
  lemmaPanel.l2 = null;
  if (result.certificate.kind !== "do-calculus") prefillDoSetsForSelection();
  clearRuleMessages();
}

function prefillDoSetsForSelection() {
  if (expressionSelection.length !== 1) return;
  const node = locateExpression(
    documentState.current,
    expressionSelection[0],
  )?.node;
  if (node?.type !== "probability") return;
  for (const panel of Object.values(panels))
    panel.sets = {
      X: [...node.probability.intervention],
      Z: [],
      Y: [...node.probability.outcome],
      W: [],
    };
}

function selectExpression(id, additive = false) {
  const node = locateExpression(documentState.current, id)?.node;
  if (!node) return;
  const previous = [...expressionSelection];
  if ((additive || $("#pair-selection").checked) && node.type !== "product") {
    const factors = expressionSelection.filter(
      (selectedId) =>
        locateExpression(documentState.current, selectedId)?.node.type !==
        "product",
    );
    expressionSelection = factors.includes(id)
      ? factors.filter((selectedId) => selectedId !== id)
      : [...factors, id];
  } else expressionSelection = [id];
  const changed = previous.join(",") !== expressionSelection.join(",");
  if (changed) prefillDoSetsForSelection();
  clearRuleMessages();
  renderRules();
  renderAlgebra();
  renderProbability();
  renderLemmas();
}

function renderLemmas() {
  renderLemmaPanel($("#lemma-rules"), {
    history: documentState.history,
    lemmas: savedLemmas,
    panel: lemmaPanel,
    label,
    ready: !!documentState.current,
    onChange() {
      lemmaPanel.message = "";
      lemmaPanel.error = false;
      renderLemmas();
    },
    onSave(l1, l2) {
      try {
        const lemma = createLemma(
          documentState.graph,
          documentState.history,
          l1,
          l2,
          {
            id: crypto.randomUUID(),
            name: `Lemma ${savedLemmas.length + 1}`,
          },
          savedLemmas,
        );
        savedLemmas.push(lemma);
        lemmaPanel.lemmaId = lemma.id;
        lemmaPanel.message = `${lemma.name} saved from lines (${l1}) and (${l2}). It remains available when you restart.`;
        lemmaPanel.error = false;
      } catch (error) {
        lemmaPanel.message = error.message;
        lemmaPanel.error = true;
      }
      renderLemmas();
    },
    onApply(lemma, direction) {
      try {
        recordStep(
          applyLemma(
            documentState.graph,
            documentState.current,
            expressionSelection,
            lemma,
            direction,
          ),
        );
        lemmaPanel.message = `Applied ${lemma.name} · ${direction === "forward" ? "l1 → l2" : "l2 → l1"}.`;
        render();
      } catch (error) {
        lemmaPanel.message = error.message;
        lemmaPanel.error = true;
        renderLemmas();
      }
    },
  });
}

function renderAlgebra() {
  renderAlgebraPanels($("#algebra-rules"), {
    graph: documentState.graph,
    panels: algebraPanels,
    ready: !!documentState.current,
    onChange(kind) {
      algebraPanels[kind].message = "";
      algebraPanels[kind].error = false;
      renderAlgebra();
    },
    onApply(kind) {
      const panel = algebraPanels[kind];
      try {
        const result =
          kind === "marginalize"
            ? applyMarginalization(
                documentState.graph,
                documentState.current,
                expressionSelection,
                panel.direction,
                panel.sets.Z,
              )
            : applyChainRule(
                documentState.graph,
                documentState.current,
                expressionSelection,
                panel.direction,
                panel.sets.Y,
                panel.sets.Z,
              );
        recordStep(result);
        panel.message = `Applied · ${ALGEBRA[kind].directions.find(([value]) => value === panel.direction)[1]}.`;
        render();
      } catch (error) {
        panel.message = error.message;
        panel.error = true;
        renderAlgebra();
      }
    },
  });
}

function renderRules() {
  const activeId = document.activeElement?.id;
  $("#rules").replaceChildren();
  for (const rule of [1, 2, 3]) {
    const panel = panels[rule];
    const card = make("article", "rule-card");
    const heading = make("div", "rule-heading");
    const button = make("button", "rule-button", `Rule ${rule}`);
    button.id = `apply-${rule}`;
    button.disabled = !documentState.current;
    button.title = `Apply rule ${rule}: ${RULES[rule].title}`;
    button.addEventListener("click", () => {
      try {
        const result = applyDoCalculus(
          documentState.graph,
          documentState.current,
          expressionSelection,
          rule,
          panel.direction,
          panel.sets,
        );
        recordStep(result);
        panel.message = `Applied · ${RULES[rule].directions.find(([value]) => value === panel.direction)[1]}. Separation condition holds.`;
        render();
      } catch (error) {
        panel.message = error.message;
        panel.error = true;
        renderRules();
      }
    });
    heading.append(button, make("h3", "rule-title", RULES[rule].title));
    card.append(heading);
    const directionLabel = make("label", "direction-label", "Direction");
    const direction = make("select");
    direction.id = `direction-${rule}`;
    direction.setAttribute("aria-label", `Rule ${rule} direction`);
    for (const [value, text] of RULES[rule].directions) {
      const option = make("option", "", text);
      option.value = value;
      direction.append(option);
    }
    direction.value = panel.direction;
    direction.addEventListener("change", () => {
      panel.direction = direction.value;
      panel.message = "";
      panel.error = false;
      renderRules();
    });
    directionLabel.append(direction);
    card.append(directionLabel);
    const boxes = make("div", "rule-sets");
    for (const setName of ["X", "Z", "Y", "W"]) {
      const box = make("fieldset");
      box.append(make("legend", "", setName));
      const options = make("div", "node-options");
      options.id = `options-${rule}-${setName}`;
      if (!documentState.graph.nodes.length)
        options.append(make("span", "no-nodes", "No nodes yet"));
      for (const node of documentState.graph.nodes) {
        const row = make("label");
        row.title = node.label;
        const checkbox = make("input");
        checkbox.type = "checkbox";
        checkbox.id = `set-${rule}-${setName}-${node.id}`;
        checkbox.setAttribute(
          "aria-label",
          `Rule ${rule}, ${setName}, ${node.label}`,
        );
        checkbox.checked = panel.sets[setName].includes(node.id);
        checkbox.disabled = Object.entries(panel.sets).some(
          ([name, values]) => name !== setName && values.includes(node.id),
        );
        checkbox.addEventListener("change", () => {
          panel.sets[setName] = checkbox.checked
            ? [...panel.sets[setName], node.id]
            : panel.sets[setName].filter((id) => id !== node.id);
          panel.message = "";
          panel.error = false;
          renderRules();
        });
        row.append(checkbox, make("span", "", node.label));
        options.append(row);
      }
      box.append(options);
      boxes.append(box);
    }
    card.append(boxes, make("p", "rule-equation", equations[rule]));
    const condition = make("p", "rule-condition");
    // Static mathematical notation only; user labels always enter through textContent.
    condition.innerHTML = `if Y ⫫ Z | X, W in G<sub><span class="overbar">X</span>${rule === 2 ? ', <span class="underbar">Z</span>' : rule === 3 ? ', <span class="overbar">Z(W)</span>' : ""}</sub>${rule === 3 ? ' · Z(W) = Z ∖ An(W) in G<sub><span class="overbar">X</span></sub>' : ""}`;
    card.append(condition);
    const status = make(
      "p",
      `rule-status${panel.error ? " error" : panel.message ? " success" : ""}`,
      panel.message ||
        "Sets must match the selected probability. X and W may be empty.",
    );
    status.setAttribute("role", "status");
    card.append(status);
    $("#rules").append(card);
  }
  if (activeId)
    document.getElementById(activeId)?.focus({ preventScroll: true });
}

function renderProbability() {
  renderExpression(
    $("#current-probability"),
    documentState.current,
    label,
    expressionSelection,
    selectExpression,
  );
  $("#expression-selection").hidden = !documentState.current;
  const chosen = expressionSelection
    .map((id) => locateExpression(documentState.current, id)?.node)
    .filter(Boolean);
  $("#selected-expression").textContent =
    chosen.length === 0
      ? "No term selected"
      : chosen.length > 1
        ? `Selected: ${chosen.length} factors`
        : chosen[0].type === "probability"
          ? "Selected: probability factor"
          : chosen[0].type === "sum"
            ? `Selected: sum over ${chosen[0].variables.map(label).join(", ")}`
            : "Selected: product";
  const steps = Math.max(0, documentState.history.length - 1);
  $("#step-count").textContent = documentState.current
    ? `${steps} checked ${steps === 1 ? "step" : "steps"}`
    : "No derivation yet";
  $("#edit-query").textContent = documentState.initial
    ? "Change initial probability"
    : "Define probability";
  $("#derivation-controls").hidden = !documentState.current;
  const revertLine = $("#revert-line");
  revertLine.replaceChildren();
  documentState.history.slice(0, -1).forEach((step, index) => {
    const option = make("option", "", `(${index}) ${format(step.expression)}`);
    option.value = String(index);
    revertLine.append(option);
  });
  revertLine.value = String(documentState.history.length - 2);
  revertLine.disabled = documentState.history.length < 2;
  $("#revert-to").disabled = revertLine.disabled;
  $("#redo-step").disabled = !documentHistory.canRedo;
  $("#derivation-message").textContent = "";
  $("#derivation").hidden = !documentState.current;
  $("#derivation-summary").textContent =
    `Derivation (${documentState.history.length})`;
  $("#history").replaceChildren();
  documentState.history.forEach((step, index) => {
    const row = make("li");
    row.append(
      make("span", "history-number", `(${index})`),
      make("span", "history-equation", format(step.expression)),
    );
    const c = step.certificate;
    row.append(
      make(
        "span",
        "history-reason",
        c
          ? c.kind === "do-calculus"
            ? `Rule ${c.rule} · ${RULES[c.rule].directions.find(([value]) => value === c.direction)[1]}`
            : c.kind === "lemma"
              ? `${c.name} · ${c.direction === "forward" ? "l1 → l2" : "l2 → l1"}`
              : `${ALGEBRA[c.kind].title} · ${ALGEBRA[c.kind].directions.find(([value]) => value === c.direction)[1]}`
          : "Initial probability",
      ),
    );
    if (c) {
      const details = make("details", "certificate");
      details.append(
        make(
          "summary",
          "",
          c.kind === "do-calculus"
            ? "Checked condition"
            : c.kind === "lemma"
              ? "Checked lemma"
              : "Checked identity",
        ),
      );
      const previousExpression = documentState.history[index - 1]?.expression;
      details.append(
        make(
          "p",
          "",
          `Applied to: ${c.targets
            .map((id) => locateExpression(previousExpression, id)?.node)
            .filter(Boolean)
            .map(format)
            .join(" and ")}`,
        ),
      );
      details.append(
        make(
          "p",
          "",
          Object.entries(c.sets)
            .map(([name, ids]) => `${name} = ${groupText(ids)}`)
            .join(" · "),
        ),
      );
      if (c.kind === "do-calculus")
        details.append(
          make(
            "p",
            "",
            `${groupText(c.sets.Y)} ⫫ ${groupText(c.sets.Z)} | ${groupText(c.conditioned)}. Cut incoming edges to ${groupText(c.incoming)}; outgoing directed edges from ${groupText(c.outgoing)}.${c.rule === 3 ? ` Z(W) = ${groupText(c.zW)}.` : ""}`,
          ),
        );
      else if (c.kind === "lemma")
        details.append(
          make(
            "p",
            "",
            `${c.name}, saved lines (${c.lines.l1}) and (${c.lines.l2}). Exact expression match; ${c.checks.length} do-calculus ${c.checks.length === 1 ? "assumption rechecked" : "assumptions rechecked"} in the current graph.`,
          ),
        );
      else
        details.append(
          make(
            "p",
            "",
            "Exact probability identity; all do(…) conditions are unchanged. No graph condition was used.",
          ),
        );
      row.append(details);
    }
    $("#history").append(row);
  });
}

function render() {
  const ids = new Set(documentState.graph.nodes.map((node) => node.id));
  for (const panel of [
    ...Object.values(panels),
    ...Object.values(algebraPanels),
  ])
    for (const key of Object.keys(panel.sets))
      panel.sets[key] = panel.sets[key].filter((id) => ids.has(id));
  expressionSelection = expressionSelection.filter((id) =>
    locateExpression(documentState.current, id),
  );
  $("#empty-graph").hidden = !!documentState.graph.nodes.length;
  $("#graph-count").textContent =
    `${documentState.graph.nodes.length} nodes · ${documentState.graph.edges.length} edges`;
  $("#undo").disabled = !documentHistory.canUndo;
  $("#redo").disabled = !documentHistory.canRedo;
  $("#export-proof").disabled = !documentState.current;
  renderCanvas();
  renderSelection();
  renderRules();
  renderAlgebra();
  renderLemmas();
  renderProbability();
}

$("#query-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    startProbability($("#query-input").value);
  } catch (error) {
    $("#query-error").textContent = error.message;
  }
});
$("#query-cancel").addEventListener("click", () => $("#query-dialog").close());
$("#query-dialog").addEventListener("cancel", (event) => {
  if (!documentState.initial) event.preventDefault();
});
$("#edit-query").addEventListener("click", openQuery);
$("#save-state").addEventListener("click", saveState);
for (const id of ["#import-state", "#query-import"])
  $(id).addEventListener("click", () => $("#state-file").click());
$("#state-file").addEventListener("change", (event) => importState(event.target.files[0]));
$("#export-proof").addEventListener("click", () => {
  $("#export-error").textContent = "";
  $("#export-dialog").showModal();
});
$("#export-cancel").addEventListener("click", () => $("#export-dialog").close());
$("#export-form").addEventListener("submit", exportProof);
$("#add-node").addEventListener("click", () => openNode());
$("#rename").addEventListener("click", () => openNode(selected.id));
$("#node-cancel").addEventListener("click", () => $("#node-dialog").close());
$("#node-form").addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    const name = validateLabel($("#node-label").value.trim());
    const graph = structuredClone(documentState.graph);
    if (graph.nodes.some((node) => node.label === name && node.id !== renameId))
      throw new Error("A node with that name already exists.");
    if (renameId) graph.nodes.find((node) => node.id === renameId).label = name;
    else
      graph.nodes.push({
        id: crypto.randomUUID(),
        label: name,
        ...nextPosition(graph.nodes),
      });
    changeGraph(graph, !renameId);
    $("#node-dialog").close();
  } catch (error) {
    $("#node-error").textContent = error.message;
  }
});
document
  .querySelectorAll("[data-tool]")
  .forEach((button) =>
    button.addEventListener("click", () => setTool(button.dataset.tool)),
  );
$("#undo").addEventListener("click", undo);
$("#redo").addEventListener("click", redo);
$("#redo-step").addEventListener("click", redo);
$("#revert-to").addEventListener("click", revertTo);
$("#delete").addEventListener("click", deleteSelection);

const operationTabs = [
  ["do-tab", "rules"],
  ["algebra-tab", "algebra-rules"],
  ["lemma-tab", "lemma-rules"],
];
function showOperations(activeId) {
  for (const [tabId, panelId] of operationTabs) {
    const active = tabId === activeId;
    $("#" + panelId).hidden = !active;
    const button = $("#" + tabId);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
}
for (const [tabId] of operationTabs)
  $("#" + tabId).addEventListener("click", () => showOperations(tabId));
document.querySelector(".step-tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = operationTabs.findIndex(
    ([id]) => $("#" + id).getAttribute("aria-selected") === "true",
  );
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? operationTabs.length - 1
        : (current +
            (event.key === "ArrowRight" ? 1 : -1) +
            operationTabs.length) %
          operationTabs.length;
  const id = operationTabs[next][0];
  showOperations(id);
  $("#" + id).focus();
});
$("#pair-selection").addEventListener("change", (event) => {
  expressionSelection = event.target.checked
    ? []
    : expressionSelection.slice(0, 1);
  prefillDoSetsForSelection();
  clearRuleMessages();
  renderRules();
  renderAlgebra();
  renderProbability();
});

const svg = $("#graph");
svg.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const nodeId = event.target.closest("[data-node]")?.dataset.node;
  const edgeId = event.target.closest("[data-edge]")?.dataset.edge;
  if (nodeId) {
    // Rendering replaces SVG nodes, so native dblclick targets are not stable.
    if (
      tool === "select" &&
      lastNodeClick?.id === nodeId &&
      event.timeStamp - lastNodeClick.time < 400
    ) {
      lastNodeClick = null;
      drag = null;
      openNode(nodeId);
      return;
    }
    chooseNode(nodeId);
    if (tool === "select") {
      const node = documentState.graph.nodes.find((node) => node.id === nodeId);
      drag = {
        id: nodeId,
        start: graphPoint(svg, event),
        original: { x: node.x, y: node.y },
        next: null,
      };
      svg.setPointerCapture(event.pointerId);
    }
  } else {
    lastNodeClick = null;
    selected = edgeId ? { kind: "edge", id: edgeId } : null;
    if (!edgeId) edgeSource = null;
    renderCanvas();
    renderSelection();
  }
});
svg.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const node = documentState.graph.nodes.find((node) => node.id === drag.id);
  if (!node) {
    drag = null;
    return;
  }
  const point = graphPoint(svg, event);
  drag.next = clampPosition(
    node,
    drag.original.x + point.x - drag.start.x,
    drag.original.y + point.y - drag.start.y,
  );
  const graph = structuredClone(documentState.graph);
  Object.assign(
    graph.nodes.find((node) => node.id === drag.id),
    drag.next,
  );
  renderCanvas(graph);
});
svg.addEventListener("pointerup", (event) => {
  if (!drag) return;
  const finished = drag;
  drag = null;
  if (
    finished.next &&
    Math.hypot(
      finished.next.x - finished.original.x,
      finished.next.y - finished.original.y,
    ) > 1
  ) {
    lastNodeClick = null;
    const graph = structuredClone(documentState.graph);
    const node = graph.nodes.find((node) => node.id === finished.id);
    if (!node) {
      renderCanvas();
      return;
    }
    Object.assign(node, finished.next);
    changeGraph(graph, false);
  } else {
    lastNodeClick = { id: finished.id, time: event.timeStamp };
    renderCanvas();
  }
});
svg.addEventListener("pointercancel", () => {
  drag = null;
  renderCanvas();
});
svg.addEventListener("keydown", (event) => {
  const nodeId = event.target.closest("[data-node]")?.dataset.node;
  const edgeId = event.target.closest("[data-edge]")?.dataset.edge;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (nodeId) chooseNode(nodeId);
    else if (edgeId) {
      selected = { kind: "edge", id: edgeId };
      renderCanvas();
      renderSelection();
    }
  } else if (
    nodeId &&
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)
  ) {
    event.preventDefault();
    const graph = structuredClone(documentState.graph),
      node = graph.nodes.find((node) => node.id === nodeId);
    const delta = event.shiftKey ? 30 : 10;
    const x =
      node.x +
      (event.key === "ArrowRight"
        ? delta
        : event.key === "ArrowLeft"
          ? -delta
          : 0);
    const y =
      node.y +
      (event.key === "ArrowDown"
        ? delta
        : event.key === "ArrowUp"
          ? -delta
          : 0);
    Object.assign(node, clampPosition(node, x, y));
    changeGraph(graph, false);
  }
  if (nodeId) svg.querySelector(`[data-node="${nodeId}"]`)?.focus();
  else if (edgeId) svg.querySelector(`[data-edge="${edgeId}"]`)?.focus();
});
document.addEventListener("keydown", (event) => {
  if (event.target.closest("input,textarea,select,dialog")) return;
  if (event.key === "Escape") {
    drag = null;
    setTool("select");
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    !event.target.closest(".probability-panel,.rules-panel")
  ) {
    event.preventDefault();
    deleteSelection();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }
});

render();
openQuery();
