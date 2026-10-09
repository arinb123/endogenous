import { ALGEBRA } from "./core/algebra.js";

function element(tag, className = "", text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderAlgebraPanels(
  container,
  { graph, panels, ready, onApply, onChange },
) {
  const focusId = document.activeElement?.id;
  container.replaceChildren();
  for (const [kind, definition] of Object.entries(ALGEBRA)) {
    const panel = panels[kind];
    const card = element("article", "rule-card algebra-card");
    const heading = element("div", "rule-heading");
    const apply = element("button", "rule-button", definition.title);
    apply.id = `apply-${kind}`;
    apply.disabled = !ready;
    apply.addEventListener("click", () => onApply(kind));
    heading.append(
      apply,
      element(
        "h3",
        "rule-title",
        kind === "marginalize"
          ? "Introduce / collapse a sum"
          : "Split / combine outcomes",
      ),
    );
    card.append(heading);
    const directionLabel = element("label", "direction-label", "Direction");
    const direction = element("select");
    direction.id = `direction-${kind}`;
    direction.setAttribute("aria-label", `${definition.title} direction`);
    definition.directions.forEach(([value, text]) => {
      const option = element("option", "", text);
      option.value = value;
      direction.append(option);
    });
    direction.value = panel.direction;
    direction.addEventListener("change", () => {
      panel.direction = direction.value;
      onChange(kind);
    });
    directionLabel.append(direction);
    card.append(directionLabel);
    const boxes = element("div", "rule-sets algebra-sets");
    for (const name of definition.sets) {
      const fieldset = element("fieldset");
      fieldset.append(element("legend", "", name));
      const options = element("div", "node-options");
      options.id = `options-${kind}-${name}`;
      if (!graph.nodes.length)
        options.append(element("span", "no-nodes", "No nodes yet"));
      graph.nodes.forEach((node) => {
        const row = element("label");
        row.title = node.label;
        const checkbox = element("input");
        checkbox.type = "checkbox";
        checkbox.id = `set-${kind}-${name}-${node.id}`;
        checkbox.setAttribute(
          "aria-label",
          `${definition.title}, ${name}, ${node.label}`,
        );
        checkbox.checked = panel.sets[name].includes(node.id);
        checkbox.disabled = Object.entries(panel.sets).some(
          ([other, values]) => other !== name && values.includes(node.id),
        );
        checkbox.addEventListener("change", () => {
          panel.sets[name] = checkbox.checked
            ? [...panel.sets[name], node.id]
            : panel.sets[name].filter((id) => id !== node.id);
          onChange(kind);
        });
        row.append(checkbox, element("span", "", node.label));
        options.append(row);
      });
      fieldset.append(options);
      boxes.append(fieldset);
    }
    card.append(boxes, element("p", "rule-equation", definition.equation));
    const hints = {
      expand: "Select one probability. Z must be absent from that factor.",
      collapse: "Select the Σ symbol. Z must match all its summed variables.",
      split:
        "Select one joint probability. Y and Z must partition its outcomes.",
      combine:
        "Select a two-factor product bracket, or select two factors within one product.",
    };
    card.append(element("p", "algebra-hint", hints[panel.direction]));
    card.append(
      element(
        "p",
        "rule-condition",
        "No graph condition. Every do(…) condition stays unchanged.",
      ),
    );
    const status = element(
      "p",
      `rule-status${panel.error ? " error" : panel.message ? " success" : ""}`,
      panel.message || "Choose the sets, then apply.",
    );
    status.setAttribute("role", "status");
    card.append(status);
    container.append(card);
  }
  if (focusId) document.getElementById(focusId)?.focus({ preventScroll: true });
}
