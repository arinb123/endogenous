/** Test-only finite evaluator. No production parsing, free-variable, algebra,
 * graph, or probability functions participate in the numerical oracle.
 */
export function* assignments(variables, cardinality, context = {}) {
  if (!variables.length) {
    yield { ...context };
    return;
  }
  const [first, ...remaining] = variables;
  for (let value = 0; value < cardinality[first]; value++) {
    yield* assignments(remaining, cardinality, { ...context, [first]: value });
  }
}

export function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function shuffled(values, random) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function evaluateTree(expression, environment, cardinality, probability) {
  if (expression.type === "probability")
    return probability(expression.probability, environment);
  if (expression.type === "product")
    return expression.factors.reduce(
      (value, factor) =>
        value * evaluateTree(factor, environment, cardinality, probability),
      1,
    );
  if (expression.type === "sum") {
    let result = 0;
    for (const boundEnvironment of assignments(
      expression.variables,
      cardinality,
      environment,
    ))
      result += evaluateTree(
        expression.body,
        boundEnvironment,
        cardinality,
        probability,
      );
    return result;
  }
  throw new Error("Unsupported test expression");
}

export function finiteModel(cardinality, seed = 1, independent = false) {
  const variables = Object.keys(cardinality);
  const tables = new Map();
  function table(actions, environment) {
    const sorted = [...actions].sort();
    const key = JSON.stringify(sorted.map((id) => [id, environment[id]]));
    if (!tables.has(key)) {
      let hash = seed;
      for (const character of key)
        hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      const random = randomGenerator(hash);
      const rows = [
        ...assignments(
          variables.filter((id) => !actions.includes(id)),
          cardinality,
        ),
      ].map((values) => ({
        values,
        // Positive independent probabilities are stable across do regimes.
        weight: independent
          ? Object.entries(values).reduce(
              (product, [id, value]) =>
                product * (value + 1 + variables.indexOf(id) / 10),
              1,
            )
          : 0.1 + random(),
      }));
      const total = rows.reduce((sum, row) => sum + row.weight, 0);
      tables.set(
        key,
        rows.map((row) => ({ values: row.values, weight: row.weight / total })),
      );
    }
    return tables.get(key);
  }
  function probability(p, environment) {
    for (const id of [...p.outcome, ...p.intervention, ...p.observation]) {
      if (!Number.isInteger(environment[id]))
        throw new Error(`Missing assignment for ${id}`);
    }
    const rows = table(p.intervention, environment);
    let numerator = 0,
      denominator = 0;
    for (const row of rows) {
      if (!p.observation.every((id) => row.values[id] === environment[id]))
        continue;
      denominator += row.weight;
      if (p.outcome.every((id) => row.values[id] === environment[id]))
        numerator += row.weight;
    }
    if (!(denominator > 0))
      throw new Error("Oracle table must be strictly positive.");
    return numerator / denominator;
  }
  const evaluate = (expression, environment) =>
    evaluateTree(expression, environment, cardinality, probability);
  return { evaluate };
}

/** Positive latent SCM: c→b→a and c←U→a. b has three values;
 * a,c,U are binary; d,e are independent auxiliary binary variables.
 * Interventions omit the manipulated node's structural factor.
 */
export function frontDoorModel(cardinality) {
  const tables = new Map();
  const bernoulli = (value, chance) => (value ? chance : 1 - chance);
  function probability(p, environment) {
    const actions = [...p.intervention].sort();
    const key = JSON.stringify(actions.map((id) => [id, environment[id]]));
    if (!tables.has(key)) {
      const fixed = Object.fromEntries(
        actions.map((id) => [id, environment[id]]),
      );
      const rows = [];
      for (const values of assignments(
        Object.keys(cardinality).filter((id) => !actions.includes(id)),
        cardinality,
        fixed,
      )) {
        let weight = 0;
        for (const u of [0, 1]) {
          let term = bernoulli(u, 0.4);
          if (!actions.includes("c"))
            term *= bernoulli(values.c, u ? 0.8 : 0.2);
          if (!actions.includes("b"))
            term *= (values.c ? [0.1, 0.3, 0.6] : [0.6, 0.3, 0.1])[values.b];
          if (!actions.includes("a"))
            term *= bernoulli(values.a, 0.1 + 0.25 * values.b + 0.15 * u);
          if (!actions.includes("d")) term *= bernoulli(values.d, 0.4);
          if (!actions.includes("e")) term *= bernoulli(values.e, 0.65);
          weight += term;
        }
        rows.push({ values, weight });
      }
      if (Math.abs(rows.reduce((sum, row) => sum + row.weight, 0) - 1) > 1e-12)
        throw new Error("SCM kernel is not normalized");
      tables.set(key, rows);
    }
    let numerator = 0,
      denominator = 0;
    for (const row of tables.get(key)) {
      if (!p.observation.every((id) => row.values[id] === environment[id]))
        continue;
      denominator += row.weight;
      if (p.outcome.every((id) => row.values[id] === environment[id]))
        numerator += row.weight;
    }
    return numerator / denominator;
  }
  return {
    evaluate: (expression, environment) =>
      evaluateTree(expression, environment, cardinality, probability),
  };
}

export function scopeFreeVariables(
  expression,
  bound = new Set(),
  result = new Set(),
) {
  if (expression.type === "probability") {
    for (const group of ["outcome", "intervention", "observation"])
      for (const id of expression.probability[group]) {
        if (!bound.has(id)) result.add(id);
      }
  } else if (expression.type === "sum") {
    scopeFreeVariables(
      expression.body,
      new Set([...bound, ...expression.variables]),
      result,
    );
  } else
    expression.factors.forEach((factor) =>
      scopeFreeVariables(factor, bound, result),
    );
  return result;
}

export function allNodes(expression) {
  return [
    expression,
    ...(expression.type === "sum"
      ? allNodes(expression.body)
      : expression.type === "product"
        ? expression.factors.flatMap(allNodes)
        : []),
  ];
}

export function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
