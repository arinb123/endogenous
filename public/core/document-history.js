const MAX_UNDO_STATES = 100;

/** Build a detached document at one line, retaining the current graph layout. */
function atLine(state, lineIndex) {
  const next = structuredClone(state);
  next.history = next.history.slice(0, lineIndex + 1);
  next.current = structuredClone(next.history[lineIndex].expression);
  return next;
}

/** Shared undo/redo for graph edits, equation edits, and derivation reversion.
 * The caller owns the current document; this class stores detached snapshots.
 * A saved lemma library belongs outside that document, so restarting or
 * traversing history does not accidentally erase reusable results.
 */
export class DocumentHistory {
  #past = [];
  #future = [];

  get canUndo() {
    return this.#past.length > 0;
  }

  get canRedo() {
    return this.#future.length > 0;
  }

  #remember(snapshot) {
    this.#past.push(snapshot);
    if (this.#past.length > MAX_UNDO_STATES) this.#past.shift();
  }

  /** Call immediately before a successful edit. Rejected edits must not call it. */
  checkpoint(state) {
    const snapshot = structuredClone(state);
    this.#remember(snapshot);
    this.#future = [];
  }

  undo(state) {
    if (!this.canUndo) return null;
    const next = structuredClone(this.#past.at(-1));
    const current = structuredClone(state);
    this.#past.pop();
    this.#future.push(current);
    return next;
  }

  redo(state) {
    if (!this.canRedo) return null;
    const next = structuredClone(this.#future.at(-1));
    const current = structuredClone(state);
    this.#future.pop();
    this.#remember(current);
    return next;
  }

  /** Return to an earlier proof line without changing the current graph.
   * Removed lines become successive redo states, ahead of any existing future.
   * Past snapshots at/after the target in this derivation are discarded so Undo
   * cannot resurrect a discarded proof branch. This includes layout-only edits
   * at those lines; redo retains the layout present when Revert was requested.
   */
  revertTo(state, lineIndex) {
    const history = state?.history;
    if (
      !Array.isArray(history) ||
      !Number.isInteger(lineIndex) ||
      lineIndex < 0 ||
      lineIndex >= history.length - 1
    ) {
      throw new Error("Choose an earlier derivation line to revert to.");
    }
    const derivationId = history[0]?.expression?.id;
    if (typeof derivationId !== "string" || !derivationId) {
      throw new Error("The derivation must have an initial expression ID.");
    }
    if (history.some((step) => !step?.expression)) {
      throw new Error("Every derivation line must contain an expression.");
    }

    // Prepare all clones before mutating either stack, including on failures.
    const next = atLine(state, lineIndex);
    const removed = [];
    for (let index = history.length - 1; index > lineIndex; index--) {
      removed.push(atLine(state, index));
    }
    const retained = this.#past.filter((snapshot) => {
      const sameDerivation =
        snapshot.history?.[0]?.expression?.id === derivationId;
      return !sameDerivation || snapshot.history.length - 1 < lineIndex;
    });
    this.#past = retained;
    this.#future.push(...removed);
    return next;
  }
}
