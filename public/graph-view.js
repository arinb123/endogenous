const NS = "http://www.w3.org/2000/svg";
const measuringContext = document.createElement("canvas").getContext("2d");
const widths = new Map();
const labelFontSize = (label) => (label.length > 18 ? 23 : 32);

function nodeWidth(label) {
  if (!widths.has(label)) {
    measuringContext.font = `${labelFontSize(label)}px Georgia`;
    widths.set(
      label,
      Math.max(70, measuringContext.measureText(label).width + 24),
    );
  }
  return widths.get(label);
}

/** Keep the entire accepted label inside the fixed graph coordinate system. */
export function clampPosition(node, x = node.x, y = node.y) {
  const margin = Math.max(40, nodeWidth(node.label) / 2 + 8);
  return {
    x: Math.max(margin, Math.min(900 - margin, x)),
    y: Math.max(75, Math.min(550, y)),
  };
}
function element(name, attributes = {}, text) {
  const result = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes))
    result.setAttribute(key, value);
  if (text !== undefined) result.textContent = text;
  return result;
}

/** SVG is presentation only; every edit goes through app.js and the pure graph validator. */
export function renderGraph(svg, graph, selected, edgeSource) {
  svg.replaceChildren();
  const defs = element("defs");
  for (const [id, color] of [
    ["arrow", "#354358"],
    ["arrow-selected", "#2d52be"],
  ]) {
    const marker = element("marker", {
      id,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: "auto-start-reverse",
    });
    marker.append(element("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color }));
    defs.append(marker);
  }
  svg.append(defs);
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const edge of graph.edges) {
    let a = nodeMap.get(edge.source),
      b = nodeMap.get(edge.target);
    if (edge.type === "bidirected" && a.x > b.x) [a, b] = [b, a];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const curve =
      edge.type === "bidirected" ? Math.min(100, distance * 0.32) : 0;
    const cx = (a.x + b.x) / 2 - (dy / distance) * curve;
    const cy = (a.y + b.y) / 2 + (dx / distance) * curve;
    const fromLength = Math.max(1, Math.hypot(cx - a.x, cy - a.y));
    const toLength = Math.max(1, Math.hypot(cx - b.x, cy - b.y));
    const sx = a.x + ((cx - a.x) / fromLength) * 15,
      sy = a.y + ((cy - a.y) / fromLength) * 15;
    const tx = b.x + ((cx - b.x) / toLength) * 15,
      ty = b.y + ((cy - b.y) / toLength) * 15;
    const d = `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
    const active = selected?.kind === "edge" && selected.id === edge.id;
    const marker = active ? "arrow-selected" : "arrow";
    const group = element("g", {
      "data-edge": edge.id,
      tabindex: 0,
      role: "button",
      "aria-label": `${a.label} ${edge.type === "directed" ? "to" : "bidirected with"} ${b.label}`,
      "aria-pressed": String(active),
    });
    group.append(
      element("path", {
        d,
        fill: "none",
        stroke: "transparent",
        "stroke-width": 18,
        class: "edge-hit",
      }),
    );
    const line = element("path", {
      d,
      fill: "none",
      stroke: active ? "#2d52be" : "#354358",
      "stroke-width": active ? 2.8 : 2,
      "marker-end": `url(#${marker})`,
      "pointer-events": "none",
    });
    if (edge.type === "bidirected") {
      line.setAttribute("marker-start", `url(#${marker})`);
      line.setAttribute("stroke-dasharray", "7 5");
    }
    group.append(line);
    svg.append(group);
  }
  for (const node of graph.nodes) {
    const active = selected?.kind === "node" && selected.id === node.id;
    const source = edgeSource === node.id;
    const width = nodeWidth(node.label);
    const group = element("g", {
      transform: `translate(${node.x},${node.y})`,
      "data-node": node.id,
      class: "graph-node",
      tabindex: 0,
      role: "button",
      "aria-label": `Node ${node.label}`,
      "aria-pressed": String(active),
    });
    group.append(
      element("rect", {
        x: -width / 2,
        y: -58,
        width,
        height: 76,
        rx: 7,
        class: "node-hit",
        fill: active || source ? "#edf2ff" : "transparent",
        stroke: active || source ? "#94a9e7" : "none",
        "stroke-dasharray": source ? "4 3" : "none",
      }),
    );
    group.append(
      element(
        "text",
        {
          x: 0,
          y: -19,
          "text-anchor": "middle",
          fill: active ? "#2449b0" : "#202936",
          "font-family": "Georgia, serif",
          "font-size": labelFontSize(node.label),
        },
        node.label,
      ),
    );
    group.append(
      element("circle", {
        r: 8,
        fill: active || source ? "#2d52be" : "#fff",
        stroke: active || source ? "#2d52be" : "#354358",
        "stroke-width": 2,
      }),
    );
    svg.append(group);
  }
}

export function graphPoint(svg, event) {
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
    svg.getScreenCTM().inverse(),
  );
  return { x: point.x, y: point.y };
}
