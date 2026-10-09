/** Independent test oracle: enumerate simple paths and inspect arrowheads.
 * Deliberately does not use latent expansion, moralization, or production helpers.
 * Definition: Evans–Richardson (2014), Definition 2.1,
 * https://arxiv.org/pdf/1301.6624 . Intended only for small test graphs.
 */
export function pathOracle(graph, left, right, conditioned = []) {
  const conditioning = new Set(conditioned);
  const colliderAllowed = new Set(conditioned);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (
        edge.type === "directed" &&
        colliderAllowed.has(edge.target) &&
        !colliderAllowed.has(edge.source)
      ) {
        colliderAllowed.add(edge.source);
        changed = true;
      }
    }
  }
  const adjacency = new Map(graph.nodes.map(({ id }) => [id, []]));
  for (const edge of graph.edges) {
    const sourceHead = edge.type === "bidirected";
    adjacency
      .get(edge.source)
      .push({ next: edge.target, headHere: sourceHead, headThere: true });
    adjacency
      .get(edge.target)
      .push({ next: edge.source, headHere: true, headThere: sourceHead });
  }
  const targets = new Set(right);
  function activePath(current, incomingHead, visited) {
    if (targets.has(current)) return true;
    for (const edge of adjacency.get(current)) {
      if (visited.has(edge.next)) continue;
      const collider = incomingHead && edge.headHere;
      if (collider ? !colliderAllowed.has(current) : conditioning.has(current))
        continue;
      visited.add(edge.next);
      if (activePath(edge.next, edge.headThere, visited)) return true;
      visited.delete(edge.next);
    }
    return false;
  }
  for (const start of left) {
    for (const edge of adjacency.get(start)) {
      if (activePath(edge.next, edge.headThere, new Set([start, edge.next])))
        return false;
    }
  }
  return true;
}

export function makeGraph(ids, directed = [], bidirected = []) {
  return {
    nodes: ids.map((id) => ({ id, label: id })),
    edges: [
      ...directed.map(([source, target]) => ({
        source,
        target,
        type: "directed",
      })),
      ...bidirected.map(([source, target]) => ({
        source,
        target,
        type: "bidirected",
      })),
    ].map((edge, index) => ({ id: `e${index}`, ...edge })),
  };
}

/** Brute transitive closure is intentionally different from production Kahn validation. */
function directedAcyclic(ids, directed) {
  const reach = ids.map(() => ids.map(() => false));
  for (const [a, b] of directed) reach[ids.indexOf(a)][ids.indexOf(b)] = true;
  for (let k = 0; k < ids.length; k++)
    for (let i = 0; i < ids.length; i++)
      for (let j = 0; j < ids.length; j++) {
        reach[i][j] ||= reach[i][k] && reach[k][j];
      }
  return ids.every((_, i) => !reach[i][i]);
}

export function* everyThreeNodeADMG() {
  const ids = ["a", "b", "c"];
  const pairs = [
    ["a", "b"],
    ["a", "c"],
    ["b", "c"],
  ];
  for (let code = 0; code < 27; code++) {
    let remaining = code;
    const directed = [];
    for (const [a, b] of pairs) {
      const orientation = remaining % 3;
      remaining = Math.floor(remaining / 3);
      if (orientation) directed.push(orientation === 1 ? [a, b] : [b, a]);
    }
    if (!directedAcyclic(ids, directed)) continue;
    for (let mask = 0; mask < 8; mask++) {
      yield makeGraph(
        ids,
        directed,
        pairs.filter((_, i) => mask & (1 << i)),
      );
    }
  }
}

export function* partitions(ids, numberOfSets) {
  for (let code = 0; code < (numberOfSets + 1) ** ids.length; code++) {
    let remaining = code;
    const groups = Array.from({ length: numberOfSets }, () => []);
    for (const id of ids) {
      const choice = remaining % (numberOfSets + 1);
      remaining = Math.floor(remaining / (numberOfSets + 1));
      if (choice > 0) groups[choice - 1].push(id);
    }
    yield groups;
  }
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function randomGraph(size, random) {
  const ids = Array.from({ length: size }, (_, index) => `n${index}`);
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const directed = [];
  const bidirected = [];
  for (let i = 0; i < size; i++)
    for (let j = i + 1; j < size; j++) {
      if (random() < 0.45) directed.push([order[i], order[j]]);
      if (random() < 0.35) bidirected.push([order[i], order[j]]);
    }
  return makeGraph(ids, directed, bidirected);
}

/** Independent rules graph: calculate ancestry by forward search from each Z. */
export function ruleOracleGraph(graph, rule, { X, Z, W }) {
  const edgesWithoutX = graph.edges.filter((edge) =>
    edge.type === "directed"
      ? !X.includes(edge.target)
      : !X.includes(edge.source) && !X.includes(edge.target),
  );
  const zW =
    rule === 3
      ? Z.filter((start) => {
          const descendants = new Set([start]);
          let changed = true;
          while (changed) {
            changed = false;
            for (const edge of edgesWithoutX) {
              if (
                edge.type === "directed" &&
                descendants.has(edge.source) &&
                !descendants.has(edge.target)
              ) {
                descendants.add(edge.target);
                changed = true;
              }
            }
          }
          return !W.some((id) => descendants.has(id));
        })
      : [];
  return {
    zW,
    graph: {
      nodes: graph.nodes,
      edges: edgesWithoutX.filter((edge) => {
        if (edge.type === "directed")
          return (
            !zW.includes(edge.target) &&
            !(rule === 2 && Z.includes(edge.source))
          );
        return !zW.includes(edge.source) && !zW.includes(edge.target);
      }),
    },
  };
}
