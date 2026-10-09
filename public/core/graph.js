/** Pure graph operations. IDs are opaque; labels and coordinates are presentation only. */
export function validateGraph(graph) {
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (ids.size !== graph.nodes.length)
    throw new Error("Node IDs must be unique.");
  const edgeIds = new Set();
  const pairs = new Set();
  const children = new Map([...ids].map((id) => [id, []]));
  const indegree = new Map([...ids].map((id) => [id, 0]));
  for (const edge of graph.edges) {
    if (edgeIds.has(edge.id)) throw new Error("Edge IDs must be unique.");
    edgeIds.add(edge.id);
    if (!ids.has(edge.source) || !ids.has(edge.target))
      throw new Error("Every edge must join existing nodes.");
    if (edge.source === edge.target)
      throw new Error("A node cannot connect to itself.");
    if (!["directed", "bidirected"].includes(edge.type))
      throw new Error("Unknown edge type.");
    const ends =
      edge.type === "bidirected"
        ? [edge.source, edge.target].sort()
        : [edge.source, edge.target];
    const key = JSON.stringify([edge.type, ...ends]);
    if (pairs.has(key)) throw new Error("That edge already exists.");
    pairs.add(key);
    if (edge.type === "directed") {
      children.get(edge.source).push(edge.target);
      indegree.set(edge.target, indegree.get(edge.target) + 1);
    }
  }
  const queue = [...ids].filter((id) => indegree.get(id) === 0);
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i])) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) queue.push(child);
    }
  }
  if (queue.length !== ids.size)
    throw new Error(
      "That edge would create a directed cycle. An ADMG must be acyclic.",
    );
  return graph;
}

/** Includes the seed nodes themselves. Only directed edges establish ancestry. */
export function ancestors(graph, seeds) {
  const parents = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    if (edge.type === "directed") parents.get(edge.target).push(edge.source);
  }
  const result = new Set(seeds);
  const queue = [...seeds];
  for (let i = 0; i < queue.length; i++) {
    for (const parent of parents.get(queue[i]) || []) {
      if (!result.has(parent)) {
        result.add(parent);
        queue.push(parent);
      }
    }
  }
  return result;
}

/** Incoming cuts remove arrowheads, including both ends of incident ↔ edges.
 * Outgoing cuts remove directed tails only: a ↔ edge has no outgoing tail.
 */
export function mutilate(graph, incoming = [], outgoing = []) {
  const into = new Set(incoming);
  const out = new Set(outgoing);
  return {
    nodes: graph.nodes,
    edges: graph.edges.filter((edge) =>
      edge.type === "bidirected"
        ? !into.has(edge.source) && !into.has(edge.target)
        : !into.has(edge.target) && !out.has(edge.source),
    ),
  };
}

/** ADMG m-separation via a canonical latent DAG and ancestral moralization.
 * Each ↔ becomes U→a,U→b with a distinct fresh latent Symbol. Restrict the DAG
 * to ancestors of both endpoints and conditioning variables, marry parents,
 * drop conditioning vertices, and test undirected reachability.
 * This is polynomial; it does not enumerate exponentially many graph paths.
 */
export function mSeparated(graph, left, right, conditioned = []) {
  validateGraph(graph);
  const ids = new Set(graph.nodes.map((node) => node.id));
  const used = new Set();
  for (const group of [left, right, conditioned]) {
    for (const id of group) {
      if (!ids.has(id))
        throw new Error("Separation sets contain an unknown node.");
      if (used.has(id))
        throw new Error(
          "Separation sets must be disjoint and contain no duplicates.",
        );
      used.add(id);
    }
  }
  const parents = new Map([...ids].map((id) => [id, []]));
  for (const edge of graph.edges) {
    if (edge.type === "directed") parents.get(edge.target).push(edge.source);
    else {
      const latent = Symbol("latent");
      parents.set(latent, []);
      parents.get(edge.source).push(latent);
      parents.get(edge.target).push(latent);
    }
  }
  const relevant = new Set([...left, ...right, ...conditioned]);
  const queue = [...relevant];
  for (let i = 0; i < queue.length; i++) {
    for (const parent of parents.get(queue[i])) {
      if (!relevant.has(parent)) {
        relevant.add(parent);
        queue.push(parent);
      }
    }
  }
  const neighbors = new Map([...relevant].map((id) => [id, new Set()]));
  function join(a, b) {
    neighbors.get(a).add(b);
    neighbors.get(b).add(a);
  }
  for (const node of relevant) {
    const ps = parents.get(node).filter((parent) => relevant.has(parent));
    for (let i = 0; i < ps.length; i++) {
      join(node, ps[i]);
      for (let j = i + 1; j < ps.length; j++) join(ps[i], ps[j]);
    }
  }
  const blocked = new Set(conditioned);
  const targets = new Set(right);
  const visited = new Set(left);
  const frontier = [...left];
  for (let i = 0; i < frontier.length; i++) {
    if (targets.has(frontier[i])) return false;
    for (const next of neighbors.get(frontier[i]) || []) {
      if (!blocked.has(next) && !visited.has(next)) {
        visited.add(next);
        frontier.push(next);
      }
    }
  }
  return true;
}
