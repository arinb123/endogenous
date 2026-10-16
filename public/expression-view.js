import { formatExpression, summationLabels } from "./core/expression.js";
import { valueName } from "./core/probability.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Each selectable syntax node has its own button; controls are never nested.
 * Brackets are deliberate: a sum's scope must stay visible beside other factors.
 */
export function renderExpression(
  container,
  expression,
  label,
  selection,
  onSelect,
) {
  const focused = document.activeElement?.dataset.expressionPick;
  const scrollLeft = container.scrollLeft;
  container.replaceChildren();
  if (!expression) {
    container.textContent = "Define a probability to begin";
    return;
  }
  function pick(node, text, accessibleName) {
    const button = element("button", "expression-pick", text);
    button.type = "button";
    button.dataset.expressionPick = node.id;
    button.setAttribute("aria-pressed", String(selection.includes(node.id)));
    button.setAttribute("aria-label", accessibleName);
    button.title = accessibleName;
    button.addEventListener("click", (event) =>
      onSelect(node.id, event.shiftKey || event.ctrlKey || event.metaKey),
    );
    return button;
  }
  function render(node, scopedLabel) {
    if (node.type === "probability") {
      const button = pick(
        node,
        formatExpression(node, scopedLabel),
        `Select factor ${formatExpression(node, scopedLabel)}`,
      );
      button.classList.add("probability-factor");
      return button;
    }
    const group = element("span", "expression-group");
    group.dataset.expressionGroup = node.id;
    group.classList.toggle("expression-selected", selection.includes(node.id));
    if (node.type === "sum") {
      const sumLabel = summationLabels(node.variables, scopedLabel);
      const button = pick(
        node,
        "",
        `Select sum over ${node.variables.map(sumLabel).join(", ")}`,
      );
      button.classList.add("sum-picker");
      button.append(
        element("span", "sigma", "Σ"),
        element("sub", "sum-variables", node.variables.map(sumLabel).join(", ")),
      );
      group.append(
        button,
        element("span", "expression-bracket", "["),
        render(node.body, sumLabel),
        element("span", "expression-bracket", "]"),
      );
    } else {
      group.append(
        pick(node, "[", `Select product ${formatExpression(node, scopedLabel)}`),
      );
      node.factors.forEach((factor, index) => {
        if (index) group.append(element("span", "multiply", "·"));
        group.append(render(factor, scopedLabel));
      });
      group.append(element("span", "expression-bracket", "]"));
    }
    return group;
  }
  container.append(render(expression, (id) => valueName(label(id))));
  container.scrollLeft = scrollLeft;
  if (focused)
    [...container.querySelectorAll("[data-expression-pick]")]
      .find((button) => button.dataset.expressionPick === focused)
      ?.focus({ preventScroll: true });
}
