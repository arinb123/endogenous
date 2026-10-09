import { formatExpression } from "./core/expression.js";

const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

function selectInput(id, name, choices, value, onChange) {
  const label = make("label", "lemma-input", name);
  const select = make("select");
  select.id = id;
  select.setAttribute("aria-label", name);
  for (const [value, text] of choices) {
    const option = make("option", "", text);
    option.value = value;
    select.append(option);
  }
  select.value = value;
  select.disabled = !choices.length;
  select.addEventListener("change", () => onChange(select.value));
  label.append(select);
  return label;
}

/** The library is independent of the active derivation and its undo history. */
export function renderLemmaPanel(
  container,
  { history, lemmas, panel, label, ready, onSave, onApply, onChange },
) {
  const activeId = document.activeElement?.id;
  const choices = history.map((step, index) => [
    String(index),
    `(${index}) ${formatExpression(step.expression, label)}`,
  ]);
  if (panel.l1 >= history.length) panel.l1 = 0;
  if (panel.l2 === null || panel.l2 >= history.length)
    panel.l2 = Math.max(0, history.length - 1);
  if (!lemmas.some((lemma) => lemma.id === panel.lemmaId))
    panel.lemmaId = lemmas[0]?.id ?? "";
  const save = make("article", "rule-card");
  save.append(make("h3", "rule-title", "Save an equality"));
  save.append(
    make(
      "p",
      "lemma-help",
      "Choose two lines from this derivation. Saved lemmas remain when you restart with a new probability.",
    ),
  );
  const inputs = make("div", "lemma-lines");
  for (const name of ["l1", "l2"])
    inputs.append(
      selectInput(
        `lemma-${name}`,
        name,
        choices,
        String(panel[name]),
        (value) => {
          panel[name] = Number(value);
          onChange();
        },
      ),
    );
  const button = make("button", "rule-button", "Save lemma");
  button.id = "save-lemma";
  button.disabled = history.length < 2;
  button.addEventListener("click", () => onSave(panel.l1, panel.l2));
  save.append(inputs, button);

  const use = make("article", "rule-card");
  use.append(make("h3", "rule-title", `Saved lemmas (${lemmas.length})`));
  if (!lemmas.length)
    use.append(
      make(
        "p",
        "lemma-help",
        "Save two checked derivation lines to reuse their equality here.",
      ),
    );
  else {
    use.append(
      selectInput(
        "saved-lemma",
        "Lemma",
        lemmas.map((lemma) => [lemma.id, lemma.name]),
        panel.lemmaId,
        (value) => {
          panel.lemmaId = value;
          onChange();
        },
      ),
    );
    const lemma = lemmas.find((lemma) => lemma.id === panel.lemmaId);
    const lemmaLabel = (id) =>
      label(id) === id ? (lemma.labels[id] ?? id) : label(id);
    for (const [name, side] of [
      ["l1", lemma.left],
      ["l2", lemma.right],
    ])
      use.append(
        make(
          "p",
          "lemma-equation",
          `${name}: ${formatExpression(side, lemmaLabel)}`,
        ),
      );
    use.append(
      selectInput(
        "lemma-direction",
        "Lemma direction",
        [
          ["forward", "l1 → l2"],
          ["reverse", "l2 → l1"],
        ],
        panel.direction,
        (value) => {
          panel.direction = value;
          onChange();
        },
      ),
    );
    const apply = make("button", "rule-button", "Apply lemma");
    apply.id = "apply-lemma";
    apply.disabled = !ready;
    apply.addEventListener("click", () => onApply(lemma, panel.direction));
    use.append(
      apply,
      make(
        "p",
        "lemma-help",
        "Select a matching expression or factors in one product. Variables and conditions must match; graph assumptions are rechecked.",
      ),
    );
  }
  const status = make(
    "p",
    `rule-status lemma-status${panel.error ? " error" : panel.message ? " success" : ""}`,
    panel.message,
  );
  status.setAttribute("role", "status");
  container.replaceChildren(save, use, status);
  if (activeId)
    document.getElementById(activeId)?.focus({ preventScroll: true });
}
