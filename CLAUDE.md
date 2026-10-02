# CLAUDE.md

An interactive force-directed mindmap of the terms in the ZTA Visual Glossary. Everything
ships in one self-contained `index.html` — markup, styles, the force simulation and the
dataset. No build step and no framework; the only external request is Google Fonts, and
`verify.mjs` at the root is tooling, not part of the page.

## The dataset lives twice

The same JSON sits embedded in `index.html` (`<script id="zta-data">`) and standalone in
`zta-glossary-data.json`, and the two must stay byte-identical. Both are produced by
`json.dumps(data, indent=2, ensure_ascii=False)`, and the standalone file carries no
trailing newline. Edit by parsing one of them, mutating the object, and regenerating both
— never by hand-editing the JSON in place, which is how the two drift. The terms array is
sorted by `id`, not `name`, so Secrets Management (`vault`) sits near TPM.

## Syncing from the glossary

Upstream source of truth is the sibling repo `~/projects/zta-visual-glossary`, in the
`TERMS` array inside its `index.html`. Extract it with that repo's own helper —
`import { extractArray } from './_terms.mjs'` — rather than parsing by hand: the
`explainer` fields are template literals, so the array is not JSON.

Its `glossary.txt` is a *generated digest* — term, full name, TL;DR, type tags and aliases
only. Useful for diffing the term list, useless for a real sync: it carries no explainers,
domains, `related` or sources.

Field mapping, glossary → mindmap:

| glossary | mindmap | note |
|---|---|---|
| `term` | `name` | |
| `acronym` | `fullName` | |
| `types[0]` | `category` | drives the type pills and the search haystack only — never colour |
| `provenance` array | `provenance` string | an empty array becomes `'Open standard'` |

`id`, `tldr`, `aliases`, `types`, `related` and `source` are copied verbatim — ids match
across both repos, so never mint a new scheme. **Explainers are not** copied: the mindmap's
are deliberate condensations, recent ones running 600–770 characters.

Two glossary fields do not carry over. `caption` is unused here, and `domains` becomes the
family assignment rather than a stored field — it is authoritative for that, with family
labels matching domain names exactly.

## Invariants

- **`--cat-6` is permanently unavailable to families.** It *is* `--accent`, which already
  paints part-of edges, hover halos and selection strokes, so a family wearing it would be
  unreadable. The tenth family took a new `--cat-10`; an eleventh needs a `--cat-11`.
- **`FAMILIES` order is the ring order.** The Zero-Trust core is listed first and sits at the
  centre; the others are placed clockwise around it in array order, so a new family lands
  between its array neighbours and should be listed next to the families it links to most.
- **Adopt glossary values rather than forcing them into existing sets.** When the glossary
  carries a value the mindmap's sets don't cover, extend the mindmap. `provenance:
  "Research method"` earned a matching `PROV_ICON` entry because the empty-array default
  would have printed "Open standard" on two research techniques.
- **Edges point at what they augment.** Infrastructure components point AT the platform
  (`cilium` → `kubernetes`, `enables`). The `alternative` legend key reads "Alternative /
  contrasts", so it legitimately carries conceptual contrasts, not only competing products.
- **UK spelling** throughout the prose ("colour", "centralised").
- **ASCII quotes throughout.** The corpus uses no typographic quotes anywhere.

## Verification

```bash
node verify.mjs      # must exit clean before any commit
```

It asserts the dual-file byte identity, the `id` sort order, that every term has an
explicit `FAMILY` entry — a miss falls back to `'transport'` silently, so it renders as a
wrong colour rather than an error — that every edge endpoint resolves with no self-edges
or duplicates, and that the term, family and edge counts agree everywhere they are printed
across the page and the README. A project hook runs it after any write touching the data
files or the README, but it is still the gate before committing.

Rendering stays a manual check: open `index.html` in both themes, confirm the graph settles
and the console is clean.

## Committing

Conventional-commit subjects, direct to `main`, with the `Co-Authored-By` trailer. Feature
commits state what was verified. Push only when James asks.
