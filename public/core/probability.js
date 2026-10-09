/** A deliberately small grammar: one P(outcomes | do(actions), observations).
 * Parsing is structural, never eval. Variables are case-sensitive identifiers.
 */
export function validateLabel(label) {
  if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(label) || label.length > 32) {
    throw new Error(
      "Use a name of up to 32 letters, digits, or underscores, starting with a letter or underscore.",
    );
  }
  return label;
}

export function parseProbability(input) {
  const text = input.trim();
  let position = 0;
  const skip = () => {
    while (/\s/u.test(text[position] || "") && position < text.length)
      position++;
  };
  const peek = () => {
    skip();
    return text[position];
  };
  function expect(character) {
    if (peek() !== character)
      throw new Error(
        `Expected “${character}” at position ${position + 1}. Use P(y | do(x), z).`,
      );
    position++;
  }
  function identifier() {
    skip();
    const match = text.slice(position).match(/^[\p{L}_][\p{L}\p{N}_]*/u);
    if (!match)
      throw new Error(`Expected a node name at position ${position + 1}.`);
    position += match[0].length;
    return validateLabel(match[0]);
  }
  function names() {
    const values = [identifier()];
    while (peek() === ",") {
      position++;
      values.push(identifier());
    }
    return values;
  }
  expect("P");
  expect("(");
  const outcome = names();
  const intervention = [];
  const observation = [];
  if (peek() === "|") {
    position++;
    do {
      const name = identifier();
      if (name === "do" && peek() === "(") {
        position++;
        intervention.push(...names());
        expect(")");
      } else observation.push(name);
      if (peek() !== ",") break;
      position++;
    } while (true);
  }
  expect(")");
  if (peek() !== undefined)
    throw new Error(
      "Only a single probability is supported, without products, sums, or equality signs.",
    );
  const all = [...outcome, ...intervention, ...observation];
  if (new Set(all).size !== all.length)
    throw new Error(
      "Each node may appear only once, as an outcome, action, or observation.",
    );
  return { outcome, intervention, observation };
}

export function validateProbability(probability, graph) {
  if (!probability?.outcome?.length)
    throw new Error("Choose at least one outcome.");
  const known = new Set(graph.nodes.map((node) => node.id));
  const all = [
    ...probability.outcome,
    ...probability.intervention,
    ...probability.observation,
  ];
  if (all.some((id) => !known.has(id)))
    throw new Error(
      "The probability references a node that is not in this graph.",
    );
  if (new Set(all).size !== all.length)
    throw new Error("Probability sets must be disjoint, without duplicates.");
  return probability;
}

export function formatProbability(probability, label = (id) => id) {
  if (!probability) return "Define a probability to begin";
  const conditions = [];
  if (probability.intervention.length)
    conditions.push(`do(${probability.intervention.map(label).join(", ")})`);
  conditions.push(...probability.observation.map(label));
  return `P(${probability.outcome.map(label).join(", ")}${conditions.length ? " | " + conditions.join(", ") : ""})`;
}
