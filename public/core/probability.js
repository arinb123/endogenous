/** A deliberately small grammar: one P(outcomes | do(actions), observations).
 * Parsing is structural, never eval. Input values resolve to capitalized variables.
 */
// Canonicalize through lowercase too: capital ẞ and ß must both resolve to SS.
// This makes displaying a value and reopening it as input a stable round-trip.
export const variableName = (name) => String(name).normalize("NFC").toLowerCase().toUpperCase().normalize("NFC");
export const valueName = (name) => variableName(name).toLowerCase().normalize("NFC");

export function validateLabel(label) {
  if (!/^[\p{L}_][\p{L}\p{M}\p{N}_]*$/u.test(label) || label.length > 32) {
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
    const match = text.slice(position).match(/^[\p{L}_][\p{L}\p{M}\p{N}_]*/u);
    if (!match)
      throw new Error(`Expected a node name at position ${position + 1}.`);
    position += match[0].length;
    return match[0];
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
  // Recognize the do(...) keyword before converting value names to variables.
  const probability = Object.fromEntries(
    Object.entries({ outcome, intervention, observation }).map(([set, names]) =>
      [set, names.map((name) => validateLabel(variableName(name)))],
    ),
  );
  const all = Object.values(probability).flat();
  if (new Set(all).size !== all.length)
    throw new Error(
      "Each node may appear only once, as an outcome, action, or observation.",
    );
  return probability;
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
  const value = (id) => valueName(label(id));
  const conditions = [];
  if (probability.intervention.length)
    conditions.push(`do(${probability.intervention.map(value).join(", ")})`);
  conditions.push(...probability.observation.map(value));
  return `P(${probability.outcome.map(value).join(", ")}${conditions.length ? " | " + conditions.join(", ") : ""})`;
}
