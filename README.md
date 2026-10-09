# Preface: Human Note
This repository was designed largely using OpenAI's Codex. I have reviewed core pieces of the code, but be wary when proceeding.

Motivation: In high school, a few friends and I got very into 'The Natural Number Game' (https://adam.math.hhu.de/#/g/leanprover-community/nng4/world/Tutorial/level/1), a Lean-based GUI in which players use the Peano axioms to prove theorems in arithmetic, algebra, etc. As a result of the gamification and set toolkit, I was able to (1) prove things much above my pay grade (having never seen a proof before), and (2) be confident my proofs were correct. In my recent work as an undergraduate RA, I've been working with front-door identification in DAGs. I designed this GUI to be more confident and efficient in writing do-calculus proofs. Thought it might be useful to anyone else interested in identification.

--- AI-generated content begins here:---

# Endogenous

A local browser workbench for drawing an acyclic directed mixed graph (ADMG) and building checked derivations with the three rules of do-calculus, marginalization, and the chain rule. Saved lemmas reuse checked equalities across equation restarts. Every operation is reversible. Proofs can be exported as PDF, Markdown, or LaTeX, and complete sessions can be saved as portable JSON.

## Run

Requires Node.js 18 or later and a modern browser on Windows, macOS, or Linux. Use a currently supported Node.js LTS release for a new installation.

```sh
cd endogenous2
npm install
npm start
```

Open **http://127.0.0.1:5173/**. The server listens only on the loopback interface. Stop the server with Ctrl+C.

To use another port, set `PORT` using your shell:

| Shell | Command |
| --- | --- |
| macOS/Linux (bash or zsh) | `PORT=5174 npm start` |
| Windows PowerShell | `$env:PORT=5174; npm start` |
| Windows Command Prompt | `set "PORT=5174" && npm start` |

```sh
npm test
```

The app makes no external requests. Install the local PDF-rendering dependencies with `npm install` before the first run. The live session stays in memory; use **Save state** when you want a portable JSON file that can be restored after reloading or closing the page.

PDF math uses bundled MathJax glyphs. Other Unicode characters in variable names use installed system or user fonts, including Windows and macOS font collections. If no installed font covers a character, PDF export reports it explicitly; install a suitable font and restart the server. PDF export requires neither Fontconfig nor a TeX installation. Compiling an exported `.tex` file separately requires XeLaTeX or LuaLaTeX and fonts covering its variable names.

## Use

1. Define the initial probability, such as `P(cancer | do(smoking), age)`. Its variables become graph nodes. Joint outcomes and multiple actions are supported, e.g. `P(y1, y2 | do(x1, x2), w)`.
2. Add further nodes with **Node**. Every set box updates immediately and expands to include the new node, including nodes absent from the initial probability. Choose **Edge →** and click source, then target; choose **Edge ↔** and click its two endpoints. Choose **Select** to move or inspect nodes. Select an edge or node and use **Delete**. Double-click a node, or use **Rename**, to edit its name.
3. Select a probability factor in the expression at the bottom. In **Do-calculus**, choose a direction and check **X, Z, Y, W**. The sets must be disjoint. Y is the selected factor's complete outcome set; X contains the actions that remain on both sides; Z is the set to insert, delete, or exchange; W contains the remaining observations. Uncheck a node's current set before assigning it to another set.
4. Click **Rule 1**, **Rule 2**, or **Rule 3**. The original verifier checks that factor and the graphical condition, then replaces only the selected factor. Surrounding sums and factors remain in place. A rejected step leaves the whole expression intact.
5. In **Probability**, choose **Marginalize → Introduce sum**, check Z, and apply to one selected probability. Z must be absent from that factor. For example, `P(y | do(x), w)` becomes `Σ_z [P(y, z | do(x), w)]`. Reverse this with **Collapse sum**, selecting the whole sum through its **Σ** symbol and checking exactly its bound variables. The sum must contain one probability with at least one outcome remaining.
6. For **Chain rule → Split joint**, select one joint probability and check two nonempty disjoint outcome sets Y and Z that cover all its outcomes. For example, `P(y, z | do(x), w)` becomes `P(y | do(x), z, w) · P(z | do(x), w)`. For **Combine factors**, select the product's opening bracket, or select two factors in a longer product. Both intervention contexts and all observations must match the chain-rule identity exactly.

Expand **Derivation** to inspect whole-expression snapshots. **Checked condition** records a do-calculus check; **Checked identity** records an algebra step. Both show the selected part and variable sets. **Checked lemma** identifies a reused equality and the number of graphical assumptions rechecked.

Variable names are case-sensitive, up to 32 letters, digits, or underscores, beginning with a letter or underscore. Unicode letters are accepted. The initial-input parser still accepts one probability, not LaTeX, variable assignments, products, sums, or equalities. Sums and products are constructed through the checked operations.

## Saved lemmas and reverting

In **Lemmas**, choose **l1** and **l2** by their numbered derivation lines, then click **Save lemma**. The defaults are the initial line and the current line. Both lines must belong to the active derivation and differ; the app replays every checked step between them before saving the equality. Lemmas are numbered automatically.

Use **Change initial probability** to begin a new derivation. The saved lemmas remain in the **Lemmas** tab. Select a matching expression, choose the saved lemma and **l1 → l2** or **l2 → l1**, then click **Apply lemma**. This appends a checked step to the new derivation. Saving a lemma itself does not change the equation or consume redo history.

A lemma matches the exact variables, actions, observations, and summation scopes shown on its saved side. Order within a variable set does not matter. Product factors must match in their displayed order. There is no wildcard substitution or dummy-variable renaming. Select a whole product/sum with its bracket/Σ, or use **Multiple factors** to select the relevant factors within one product. Selections cannot cross summation boundaries. Substitution keeps all surrounding factors and sums intact, gives inserted terms fresh selectable IDs, and enforces the same nested-sum restrictions as the other operations.

Graph assumptions are retained as the original do-calculus rule inputs, including assumptions inherited from other lemmas. Each application rechecks them on the current graph; Rule 3 recomputes its ancestor set. Graph edits do not erase saved lemmas, but an equality cannot be reused if its proof's assumptions no longer hold or its variables have been removed. Pure algebra lemmas require no graphical independence check. Moving/renaming nodes and adding unrelated variables preserve applicability.

Beneath the current expression, **Revert to** defaults to the previous derivation line. Choose any earlier line to jump back. The graph and saved lemmas stay in place, and **Redo step** restores the removed lines one at a time. Selecting terms, changing checkboxes, saving lemmas, and rejected operations leave redo available. A successful equation operation, graph edit, or initial-probability restart starts a new branch and clears redo. The toolbar's Undo/Redo and keyboard shortcuts share this history. Reverting discards layout-only undo checkpoints at or after the destination line; redo of reverted lines retains the layout present when you reverted.

Lemmas are kept for this browser session, including across restarts and undo/redo. **Reloading or closing the page clears them**, like the graph and derivation.

## Exporting and saving state

Click **Export Proof** at any point after starting a derivation. **PDF** uses typeset LaTeX math, while **Markdown** contains display-math LaTeX blocks and **LaTeX** is a complete XeLaTeX/LuaLaTeX document. Only lemmas used by the active derivation are included, in dependency order, before the compact `(n) Given:` / `(n) Rule ..., with ...` proof steps.

**Save state** downloads a versioned JSON file containing the graph (including node positions and stable IDs), initial probability, active derivation snapshots and checked certificates, and saved lemmas with their proof intervals. **Import state** validates and replays that file before replacing the current document, so a failed import leaves the workbench untouched. Imported IDs and expression scopes are preserved exactly.

## Selection and summation scope

Click a probability to select one factor, **Σ** to select its whole sum, or an opening product bracket to select that product. Blue outlines show the selection. Enable **Multiple factors** to select factors by clicking each one; click a selected factor again to deselect it. Shift-click or Ctrl/Cmd-click also adds/removes factors. Chain rule requires exactly two probability factors; a lemma may match more factors or include sum factors. Chain-rule combination works only for probability factors in the same product; it cannot cross a summation boundary.

The notation keeps explicit brackets around sum bodies. A local sum never captures a sibling factor. In `P(z | x) · Σ_x [P(y, x | z)]`, the x in the first factor remains free while the x inside the brackets is bound. The application uses a lexical expression tree to preserve that distinction. A sum's variable may appear in an enclosed factor's observations or `do(...)` after a valid do-calculus step.

This MVP rejects reuse of an enclosing sum's variable in a nested sum, rather than implementing dummy-variable renaming. It also does not distribute sums, move factors across sums, collapse a sum of conditional probabilities as though it were a joint marginal, or normalize an entire distribution to the scalar 1. Collapsing a sum requires its full binder set; nested sums can be collapsed individually from the inside out.

Graph structure changes restart the derivation at its initial probability. Moving or renaming nodes preserves it. Undo/Redo restore graph and derivation together, with up to 100 undo entries. A node used in the initial probability cannot be deleted until the initial probability changes. **Change initial probability** restarts the derivation while retaining the graph and adding newly mentioned nodes.

Keyboard: Tab through nodes and controls; Enter/Space selects a focused node/edge (or chooses an edge endpoint). Arrow keys move a focused node, Shift+Arrow moves farther. Delete removes the selected item. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes. Escape cancels the edge tool or a drag.

## Reproduce the sketch

Start with `P(cancer | do(smoking), age)`, add `tar`, and draw:

```text
age → smoking → tar → cancer
      smoking ↔ cancer
```

For Rule 1, choose Delete observation and set X={smoking}, Z={age}, Y={cancer}, W=∅. The result is `P(cancer | do(smoking))`.

For a positive Rule 2 test on this graph, change the initial probability to `P(tar | do(smoking))`. Set X=∅, Z={smoking}, Y={tar}, W=∅. Action → observation produces `P(tar | smoking)`; reversing the direction restores the original expression.

## Verification model

The three equalities and their graph conditions follow [Pearl, _The Do-Calculus Revisited_ (2012), §1.2](https://ftp.cs.ucla.edu/pub/stat_ser/r402.pdf). All four sets are pairwise disjoint. Every rule tests `Y ⟂ Z | X ∪ W` after the required graph modification:

| Rule | Incoming cuts | Outgoing directed cuts |
| ---- | ------------- | ---------------------- |
| 1    | X             | none                   |
| 2    | X             | Z                      |
| 3    | X ∪ Z(W)      | none                   |

For Rule 3, `Z(W) = Z \ An(W)` is computed using directed ancestry **in the graph with incoming edges to X removed**, before cutting incoming edges to Z(W). Incoming cuts delete all incident bidirected edges; outgoing cuts preserve bidirected edges.

Separation for an ADMG is **m-separation**. The implementation replaces each bidirected edge with a separate latent common parent, computes the ancestors of the endpoint and conditioning sets, moralizes that ancestral DAG, removes conditioned nodes, and checks connectivity. It does not conflate a bidirected edge with two directed edges. See also [Evans and Richardson, _Markovian Acyclic Directed Mixed Graphs for Discrete Data_, Definition 2.1](https://arxiv.org/pdf/1301.6624).

Each do-calculus transformation requires an exact set match to the selected probability factor. Extra conditioning variables cannot be silently ignored. Empty X and W are allowed. Empty Y and empty Z are rejected. Bows (A→B and A↔B together) and bidirected cycles are allowed; directed cycles, self-edges, and duplicate edges of the same type are rejected.

Marginalization and the chain rule are ordinary probability identities within a fixed intervention regime. They check exact variable sets and expression shape, with no graph-separation test. Every `do(...)` condition is copied unchanged. Reverse chain-rule matching accepts either physical factor order and leaves unselected factors untouched. The probability identities are summarized in [Carnegie Mellon's probability reference](https://www.cs.cmu.edu/~07280/notes/probability/index.html).

These steps are algorithmically checked, wherever the conditional distributions are defined. Sums are formal discrete marginalizations; the app does not evaluate numerical distributions. This is not a Lean/Coq proof-assistant certificate, a numerical positivity check, or an automatic identification algorithm. Bayes' rule, standalone conditioning operations, and other symbolic algebra remain outside this MVP.

## Code map

| File                                     | Responsibility                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `public/core/graph.js`                   | ADMG validation, directed ancestry, graph cuts, m-separation                                            |
| `public/core/probability.js`             | Small probability grammar, model validation, formatting                                                 |
| `public/core/calculus.js`                | Exact expression matching, six directed rule applications, recorded conditions                          |
| `public/core/expression.js`              | Immutable probability/product/sum tree, IDs, lexical scope, traversal, replacement and formatting       |
| `public/core/algebra.js`                 | Reversible marginalization and chain rule; selected-factor adapter to the original do-calculus verifier |
| `public/expression-view.js`              | Accessible selection of factors, sums and products; explicit visual scope                               |
| `public/algebra-panel.js`                | Variable checkboxes and direction controls for the two probability identities                           |
| `public/graph-view.js`                   | SVG rendering and pointer coordinate conversion                                                         |
| `public/app.js`                          | UI events, document state, undo/redo, invalidation and rendering                                        |
| `public/index.html`, `public/styles.css` | Layout, dialogs, accessible controls and responsive styles                                              |
| `server.mjs`                             | Loopback-only static server and local PDF export endpoint                                               |
| `proof-pdf.mjs`                           | LaTeX-to-SVG math typesetting and vector PDF rendering                                                  |
| `public/core/state.js`                    | Versioned JSON save/import schema and proof replay validation                                           |
| `public/core/proof-export.js`             | Renderer-independent proof model plus Markdown and LaTeX exporters                                      |
| `tests/oracle.mjs`                       | Independent simple-path m-separation and graph-cut oracle                                               |
| `tests/core-correctness.test.mjs`        | Exhaustive small-graph comparisons and regressions                                                      |
| `tests/numerical-oracle.mjs`             | Independent finite probability kernels, lexical expression evaluator and latent-confounder SCM          |
| `tests/algebra-correctness.test.mjs`     | Numerical identities, scope, exact rejection, immutability and full front-door derivation               |
| `tests/document-history.test.mjs`       | Document snapshots, graph/equation undo, reversion and redo                                           |
| `tests/proof-export.test.mjs`           | Compact proof formatting, checked lemma dependencies and export validation                            |
| `tests/portability.test.mjs`            | Server startup, static files, Unicode JSON round trips and proof exports through portable Node APIs   |

The core modules are pure and DOM-independent. Graph IDs remain stable when labels change; expression IDs identify selectable syntax nodes. Operations return a new expression, a detached record of their checks, and a valid next selection. Products are represented as ordered lists; adjacent nested products are flattened structurally, while sums retain their exact scope. UI code commits a complete checked result atomically. The original graph and do-calculus modules remain separate from algebra and expression rendering.

## Validation performed

Run `npm test` for the automated checks. The GitHub Actions workflow runs them on Linux, Windows, and macOS with Node.js 22 and 24, including server startup and PDF exports. A configured CI matrix is not evidence of a passing run; inspect its results on your repository before release.

The mathematical checks include:

- 43,293 separation comparisons against an independent path-based oracle.
- 43,476 full rule applications, including rejection cases, compared against independent graph cuts and separation.
- Every labelled three-node ADMG; seeded four-to-six-node graphs, multivariate sets, collider descendants, 479 bows, and both directions of all rules.
- Regression cases for Rule 3 ancestry after cutting X, incident bidirected cuts, omitted expression variables, malformed expressions, rejected cycles, and immutable verification records.
- 63,158 randomized numerical comparisons for marginalization and chain rule over 480 positive finite kernel families, including multivariate sets, every free/intervention assignment, and reverse factor/selection orders.
- Scoped fixtures for untouched siblings, nonadjacent pair combination, nested sums, exact context mismatches, forbidden cross-sum combinations, frozen inputs and independent records.
- A full nine-step front-door derivation, with every intermediate expression checked numerically against a positive model with latent confounding. Its inner sum binds treatment locally while treatment remains free in a sibling factor.

Browser checks for the original MVP covered the sketch's Rule 1 example, both directions of all three rules, rejection of a confounded exchange and a directed cycle, double-click renaming, graph-edit invalidation, Undo/Redo, and a maximum-length label. Extension checks cover introduce-sum → split → local do-calculus and its reverse → combine → collapse, complete-expression history, Undo/Redo and factor selection. The test sessions had no browser console errors.

The added-node regression was verified with `P(y | do(x), w, t)`: adding `z` updates all 15 set boxes without clipping; Undo/Redo updates them again; Rule 1 insertion using Z={z}, X={x}, Y={y}, W={w,t} succeeds on the test graph with isolated nodes.
