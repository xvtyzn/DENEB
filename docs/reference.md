# DENEB reference

[Back to the overview](../README.md) · [日本語リファレンス](reference.ja.md)

**D**rawing **E**ngine for **N**otated, **E**ngineered **B**iologics — declarative
SVG diagrams of antibody formats, for embedding in a web app.

Give it a description of the chains and domains of a molecule and it draws the
cartoon: Fab arms on an Fc stem, tandem scFvs, diabodies, appended IgGs,
non-immunoglobulin fusions. Variable domains are coloured by the target they
bind, so a bispecific reads as a bispecific at a glance. Engineering shows up
where it belongs — knob-into-hole cut into the CH3 outlines, Fc-silencing
mutations on the interface edge, glycans and conjugated ADC payloads hanging off
the surface — and everything drawn is collected into a legend.

The package is deliberately narrow: **it visualises an annotation, it does not
produce one.** Feed it the output of your own HMM / ML domain caller.

![Six antibody formats drawn from the same palette](images/formats.png)


- Zero runtime dependencies; the core is framework-agnostic and renders to a
  plain SVG string, so it also works in Node for SSR, static export and tests.
- React components (`deneb/react`) render normal Scene nodes as real elements,
  so `onClick` / `onMouseEnter` land on the domain groups directly. Trusted
  inline `payload.structure.svg` markup is the explicit exception and is
  inserted verbatim; use `href` for user-supplied artwork.
- 49 bundled presets covering the common bispecific, fragment and ADC formats.

## Install

```sh
npm install deneb
```

`react` and `react-dom` are optional peer dependencies; you only need them for
`deneb/react`.

## Quick start

```ts
import { renderSVG, type Construct } from 'deneb';

const spec: Construct = {
  name: 'IgG(kih) 1+1 bispecific',
  chains: [
    {
      id: 'HC1',
      domains: [
        { type: 'VH', start: 1, end: 120, specificity: 'CD3' },
        { type: 'CH1', start: 121, end: 218 },
        { type: 'hinge', start: 219, end: 233 },
        { type: 'CH2', start: 234, end: 341, modifications: [{ type: 'lala' }] },
        { type: 'CH3', start: 342, end: 447, modifications: [{ type: 'knob' }] },
      ],
    },
    { id: 'LC1', domains: [{ type: 'VL', specificity: 'CD3' }, { type: 'CL' }] },
    {
      id: 'HC2',
      domains: [
        { type: 'VH', specificity: 'HER2' },
        { type: 'CH1' },
        { type: 'hinge' },
        { type: 'CH2', modifications: [{ type: 'lala' }] },
        { type: 'CH3', modifications: [{ type: 'hole' }] },
      ],
    },
    { id: 'LC2', domains: [{ type: 'VL', specificity: 'HER2' }, { type: 'CL' }] },
  ],
};

const { svg, layout, scene } = renderSVG(spec);
```

In React:

```tsx
import { AntibodyViewer } from 'deneb/react';

<AntibodyViewer
  construct={spec}
  colorMode="specificity"
  highlight={['spec:CD3']}
  onDomainClick={(info) => console.log(info.domain.id, info.domain.start, info.domain.end)}
  renderTooltip={(info) => <>{info.domain.label} · {info.domain.specificity ?? 'constant'}</>}
/>
```

From a clone of this repository, `npm run playground` builds and opens
[`examples/playground.html`](../examples/playground.html), where you can edit the
notation — the DSL or AbML — and watch the drawing follow. It has to be served
rather than opened from disk, because browsers refuse ES modules over `file://`.
`npm run gallery` writes `examples/gallery.html` with every preset drawn in both
views; that one is a plain file you can open.

## The notation

Structured JSON is the canonical input, but the same molecule can be written as
a compact string — useful for tests, for storing a format in a database column,
and for a human sanity-check of what the domain caller produced.

```
@name  IgG(kih) 1+1 bispecific
HC1: VH(CD3)-CH1-h-CH2[lala]-CH3[knob]
LC1: VL(CD3)-CL
HC2: VH(HER2)-CH1-h-CH2[lala]-CH3[hole]
LC2: VL(HER2)-CL
```

```ts
import { parseDSL, stringifyDSL, renderSVG } from 'deneb';
renderSVG(parseDSL(source));
```

| Syntax | Meaning |
| --- | --- |
| `ID: …` | chain label; omit it and chains are named `C1`, `C2`, … |
| `-` | join two domains directly |
| `~` | join through a flexible linker (`VH(A)~VL(A)` is an scFv) |
| `(TARGET)` | the target this domain helps bind; drives the colour |
| `[mod, mod=R1/R2]` | engineering modifications, optionally with residues |
| `[drug=NAME/linker/DAR/copies/site]` | a conjugated payload (see below) |
| `*n` | this chain exists in `n` identical copies (symmetric homodimers) |
| `#` | comment to end of line |
| `;` | line separator, so the whole thing fits on one line |

Domain names are case-insensitive: `VH VL VHH CH1 CL CH2 CH3 CH4 h`(inge)
`L`(inker) `scFv Fab Fc TCRa TCRb albumin`/`HSA` `cytokine toxin payload ECD`.
`scFv` expands to `VH~VL`, `Fab` also generates the matching light chain, and
`Fc` expands to `CH2-CH3`. Anything unrecognised becomes a custom domain drawn
with its own name, so novel building blocks still show up.

Directives: `@name`, `@color TARGET=#rrggbb`, `@skeleton y|row`, `@arm <degrees>`,
`@armmode splayed|crossed`, `@pair A:0 B:2`, `@ss A:2 B:0`.

`@pair` matters when the automatic inference cannot know the answer — a TandAb's
four cross-chain Fv pairs, for instance.

## What gets inferred

`normalize()` fills in everything the layout needs and **never throws**; anything
ambiguous or malformed comes back in `diagnostics` and the molecule still draws.
That matters when the input is machine-generated and occasionally incomplete.

- **Chain roles.** A chain carrying an Fc or a hinge is heavy; once any heavy
  chain exists, every other chain with a Fab constant domain is light. This is
  what keeps a CrossMab light chain — which carries CH1, not CL — from being
  mistaken for a heavy chain.
- **Pairing.** Explicit `links` win. Then intra-chain Fv pairs (adjacent across a
  linker, *and* agreeing on target, which is what stops a diabody being read as
  an scFv), then cross-chain pairs matched by target, then heavy/light matched
  positionally — position, not domain type, so CrossMab swaps survive. Finally
  CH2/CH3/CH4 dimerise between the first two heavy chains.
- **Copies.** `copies: 2` (or `*2`) materialises real chains, and a lone light
  chain shared by several heavy chains (common-LC designs) is cloned so every
  arm has one.
- **Skeleton.** An Fc or a Fab constant domain gives the `y` skeleton; anything
  else is laid out as a `row`. Cross-paired variable domains (diabody, DART)
  switch the arms into `crossed` mode. Override any of it via `layout`.

## Views

Every molecule can be drawn three ways. The cartoon is the default; the linear
view lays each chain out as a track, which is the readable one once a construct
has more domains than an eye can follow around a Y.

![The linear view of a trispecific IgG(kih)-scFv](images/linear.png)


| Function | Component | What it draws |
| --- | --- | --- |
| `renderSVG` | `<AntibodyViewer>` | the cartoon |
| `renderLinear` | `<AntibodyLinear>` | one domain-architecture track per chain |
| `renderLegend` | `<AntibodyLegend>` | targets and modifications on their own |

`renderLinear` draws bars to residue scale whenever the domains carry
`start`/`end`, and puts a modification tick at `positions[0]` when given — this
is the view to use for showing exactly where a mutation sits.

All three return `{ svg, scene }`; `renderSVG` also returns the `layout`, with
per-domain coordinates and the diagnostics.

## Modifications

![An IgG(kih) bispecific with knob-into-hole cut into the CH3 outlines](images/bispecific.png)


Each entry is `{ type, label?, residues?, positions?, marker?, color?, payload? }`.
Labels and default residues come from a catalog, so `{ type: 'lala' }` is enough
to get a legend entry reading `LALA (Fc-silenced)` with `L234A/L235A`.

Where a mark goes is part of the meaning. Interface engineering stacks along the
edge facing the partner domain — which is the CH3–CH3' axis for a knob, but the
CH1–CL interface for a CrossMab crossover. Anything attached to the outside of
the protein hangs off the solvent-facing edge instead.

| Group | Types |
| --- | --- |
| heterodimerization | `knob` `hole` `charge+` `charge-` `duobody` `seed` `ew-rvt` `ha-tf` |
| chain pairing | `crossmab-fab` `crossmab-ch1cl` `crossmab-vhvl` `orthogonal-fab` `disulfide` |
| effector function | `lala` `lala-pg` `s228p` `glycan` `afucosyl` `aglycosyl` `adcc-enhanced` |
| half-life | `yte` `ls` |
| conjugation | `drug` `thiomab` `peg` `tag` |

`knob` and `hole` are cut into the CH3 outline itself so the two domains visibly
interlock rather than carrying a badge. `glycan` and `afucosyl` draw the branched
N297 stub, `peg` a chain, `thiomab` a free sulfhydryl waiting for a linker.
Common shorthand is accepted as an alias (`kih`, `n297`, `de`, `adc`, `his-tag`,
`igg4`, …), and unknown names survive as `{ type: 'custom', label }` rather than
failing.

## Conjugates

An ADC's warhead is drawn, not merely named. Give a `drug` modification a
`payload` and the domain grows a stalk — standing for the chemical linker —
ending in the compound's glyph with its name beside it, while the linker, DAR
and conjugation site are collected into their own `Conjugation` legend section.

![An interchain-cysteine ADC, with the thiol the linker is bonded to](images/adc.png)

The sulphur the linker actually hangs from is drawn on the bond, and the linker
itself is a real depiction of the chemistry rather than a cartoon blob.

```ts
{
  type: 'CH2',
  modifications: [
    {
      type: 'drug',
      payload: {
        name: 'MMAE',
        linker: 'mc-vc-PAB',
        dar: 4,                    // bracketed as `n = 4`, and in the legend
        count: 2,                  // glyphs drawn on this domain
        site: 'interchain cysteine',
        attachment: 'S',           // the atom on the bond; derived from `site`
        cleavable: true,           // false draws the bond broken
        shape: 'hexagon',          // circle | triangle | diamond | square | star
      },
    },
  ],
}
```

The conjugation is drawn the way an ADC scheme writes it: a bond off the domain's
surface, the atom the chemistry leaves behind — `S` for a cysteine thiol, `NH`
for a lysine amide, `N` for a glycan or click handle, inferred from `site` unless
you set `attachment` yourself — and then the linker-payload, bracketed with
`n = DAR` when you give one.

When you supply a structure, draw the linker in its **conjugated** form and point
`attach` at the atom that carries the bond. The antibody's bond then lands on
that atom rather than on the edge of a box, and the drawing answers the question
that actually matters: not that a payload is attached, but *where* on the linker
it is attached. The synthetic `attachment` label is dropped in that case, because
the drawing already shows the atom and the bond it makes.

A schematic reads better with the chemistry spelled out once, so an inline
structure is drawn at **one** conjugation site — chosen, where you named the
conjugated atom, so the molecule extends away from the antibody and needs no
mirroring — while the other sites keep their payload glyph. Pass
`repeatStructures: true` to draw it everywhere. Artwork is not mirrored by
default; set `structure.mirror: true` if the far-side copy may be flipped. Atom
labels are kept readable when that opt-in flip is applied.

The same thing in the notation, compound first:

```
LC: VL(HER2)-CL[drug=MMAE/vc-PAB/4/2/interchain cysteine]
```

Site-specific conjugation reads as two marks: `thiomab` for the engineered
cysteine, `drug` for what was attached to it. `showPayloadNames: false` keeps the
glyphs but drops the names.

### Chemical structures

Drawing a structure from a SMILES string needs a chemistry toolkit, which this
library deliberately does not carry. Generate the artwork with whatever you
already use — RDKit, OpenChemLib, Ketcher, ChemDraw — and hand the result over:

```ts
payload: {
  name: 'MMAE',
  structure: {
    href: 'data:image/svg+xml;base64,…',  // or `svg: '<g>…</g>'` for inline markup
    viewBox: '0 0 300 200',               // the artwork's own coordinate system
    width: 96, height: 58,                // drawn size, in diagram units
    attach: { x: 300, y: 100 },           // conjugated atom, in viewBox coordinates
    caption: 'MMAE (auristatin)',         // defaults to the payload name
  },
}
```

`showStructures` decides where it goes: `'legend'` (the default) adds captioned
thumbnails under the legend, `'inline'` bonds the drawing straight onto the
conjugation site in place of the payload glyph, and `'none'` ignores it.

An inline drawing is placed so that `attach` — the atom that is conjugated —
lands exactly on the end of the bond leaving the domain. With a `viewBox`, use
that coordinate system; without one, use fractions of the drawn box. Artwork is
not mirrored by default because mirroring can invert wedge stereochemistry. Set
`mirror: true` only when the depiction may be flipped to face away from the
antibody. It stays upright however far its domain is tilted, and the diagram's
viewBox widens to fit. Crop your artwork tight: a viewBox with a wide margin puts
empty space where the bond should meet the molecule — `scripts/adc-demo.mjs`
shows how to compute a tight one from a toolkit's output.

`svg` markup is placed in the document **verbatim and unsanitised**, so pass only
markup you trust; `href` is the safer route for anything that came from a user.

## Drawing style

Every domain is the same rounded box, a little over three units tall for every
two wide — roughly the proportions of the Ig fold itself. Variable domains are
told apart from constant ones by colour and a rounder corner, not by a different
outline, so a chain of mixed domains reads as one strand. The boxes carry no text
by default — pass `showLabels: true` if you want `VH`/`CH1` written inside them
(they stay upright whatever angle their domain sits at). The linear view labels
its bars by default; pass `showLabels: false` to hide them there.

**Every domain is drawn N-terminus first.** A linker therefore always leaves one
domain's C-terminal face and arrives at the next one's N-terminal face, never
doubling back into the end it came from. The two halves of a single-chain Fv still
stand level and side by side the way an Fv actually packs — they are only set a
little further apart than a natively paired VH/VL, to give the strand a gap to run
up. Which half is on which side is what makes `VH~VL` and `VL~VH` different
pictures, the same distinction AbML draws by naming an scFv after its N-to-C order.

Linkers are routed, not just drawn. The strand between two level domains needs a
cubic — it has to leave downwards and arrive downwards — and the route is chosen
by trying the tightest first: up the gap between the pair, then, if something sits
in the way, an arc that drops clear and sweeps over the top. That is how a
diabody's crossed strands end up arcing over the module instead of disappearing
under it. Crossing is allowed; running along another strand, or across any glyph
including its own, is not — all of it is checked for every preset in the test
suite.

Each Fab arm is positioned by the domain that continues into the hinge, so the
hinge is always a short vertical stub in the same lane as the Fc below it — for a
CrossMab too, whose heavy chain carries CL rather than CH1. A C-terminal fusion
likewise drops out of the bottom of the CH3 it leaves, rather than off a corner,
and a light chain carrying its own C-terminal fusion sends it out on a branch
instead of wedging it between the Fab and the Fc.

The two termini of a variable domain both sit at the end away from the paratope,
so a single-chain Fv's linker loops under the head from the base of one domain to
the base of the next. That is what makes `VH~VL` and `VL~VH` come out as
different pictures rather than the same one. `showTermini: true` adds small N and
C letters at the free ends of every chain when the direction has to be beyond
doubt.

## Colour

Targets are assigned colours from a colour-vision-deficiency-safe palette in
order of first appearance, blue and red first to match the convention in the
format literature. Variable domains take the target colour — the light-side
partner in a lighter tint — and constant domains stay neutral grey. Set
`colorMode` to `'chain'` or `'domain'` to recolour, `@color`/`specificities` to
pin a specific colour, and `theme` to change palette, geometry, fonts or stroke
weights.

## Interaction and export

Every domain is a `<g>` carrying `data-domain-id`, `data-chain-id`,
`data-domain-type`, `data-specificity` and `data-start`/`data-end`; markers carry
`data-modification-type`. That is enough to wire up hit-testing yourself, and
the React components do it for you via `onDomainClick`, `onDomainHover`,
`onModificationClick` and `renderTooltip`.

`highlight` accepts `'HC1:CH3'`, `'chain:LC1'`, `'spec:CD3'`, `'mod:knob'` or a
raw domain id — handy for linking the diagram to a sequence viewer.

`downloadSVG(svg)` and `downloadPNG(svg, name, { scale })` are browser helpers;
`svgToPngDataUrl` gives you the data URL if you would rather place it yourself.

## Beyond the viewer

Everything past drawing lives behind its own subpath, so a page that only
renders a diagram never loads any of it. The core entry is 26 kB gzipped and
does not reach the presets, the linter, the diff, the importers, or the AbML and
VERITAS adapters — checked by
`tests/boundaries.test.ts` in source and by `npm run size` in the built output.

| Import | Gzipped | What it is |
| --- | --- | --- |
| `deneb` | 26 kB | model, notation, layout, renderers |
| `deneb/react` | 30 kB | the components |
| `deneb/presets` | 11 kB | the 49 bundled formats |
| `deneb/lint` | 11 kB | design checks |
| `deneb/diff` | 10 kB | parent/variant comparison |
| `deneb/panel` | 29 kB | multi-molecule figures |
| `deneb/import` | 3 kB | ANARCI / IgBLAST adapters |
| `deneb/abml` | 13 kB | AbML notation, read and written |
| `deneb/veritas` | 13 kB | VERITAS format names, read and written |

### Design checks

```ts
import { lint } from 'deneb/lint';

for (const finding of lint(construct)) {
  console.log(finding.level, finding.rule, finding.message, finding.hint);
}
```

These are checks on the design, not on the drawing: two different light chains
with nothing steering each to its own heavy chain, a knob with no hole, a CD3
engager whose Fc has not been silenced, an IgG4 hinge that will exchange arms,
a non-positive DAR or one above the built-in 0–8 screening range. Each finding
carries `refs` in the form
`highlight` takes, so a UI can light up exactly what the message is about.

Rules that rely on naming or broad screening assumptions are marked `heuristic`
in `LINT_RULES` and can be turned off. For example:

```ts
lint(construct, { disable: ['effector-active-engager', 'dar-out-of-range'] });
```

Severity is adjustable the same way.

### Comparing a variant with its parent

![A parent IgG(kih) beside a CrossMab variant, with the changes highlighted](images/diff.png)


```ts
import { diff } from 'deneb/diff';
import { renderComparison } from 'deneb/panel';

const { svg, changes } = renderComparison(parent, variant, { labels: ['parent', 'v2'] });
```

Chains are matched by id first and by composition second, so renaming a chain
does not read as a chain being replaced. Sequences are compared residue by
residue when they are the same length; when they are not, only the change in
length is reported — guessing an alignment would invent mutations that are not
there.

### Figures with several molecules

The panel at the top of this page is one call: every molecule is drawn to the
same scale, one palette runs across all of them so a target keeps its colour,
and the legend is built once from the union of what they contain.


```ts
import { renderPanel } from 'deneb/panel';

const { svg } = renderPanel(
  formats.map((f) => ({ construct: f.construct, label: f.name })),
  { columns: 3, title: 'Bispecific formats' },
);
```

Colours are assigned once across the whole figure. Rendered one at a time, each
construct numbers its targets from scratch and the second cell's CD3 comes out
the colour of the first cell's HER2; a panel is only readable if a target keeps
one colour throughout. Cells are drawn at one scale so sizes can be compared,
and there is one legend rather than one per cell.

### Starting from a sequence

```ts
import { fromANARCI, fromIgBLAST } from 'deneb/import';

const { construct, diagnostics } = fromANARCI(csv, { sequences: { HC: heavy, LC: light } });
```

`fromANARCI` reads `--csv` output (indices converted from ANARCI's zero-based to
the model's one-based) and `fromIgBLAST` reads AIRR `-outfmt 19`, which already
carries the sequence and the framework/CDR coordinates. CDRs land in
`Domain.regions`; for ANARCI they are read only for IMGT numbering, because
encoding Kabat and Chothia ranges from memory would quietly mislabel someone's
loops.

Both tools annotate the variable domain and stop, so the rest of each chain is
named by matching it against human constant regions — the sequences and their
CH1 / hinge / CH2 / CH3 boundaries come from UniProt (P01857, P01859, P01861,
P01834, P0CG04) and are regenerated by `npm run constant-regions`, never typed
by hand. Comparison is ungapped and anything below `minIdentity` is left as an
unnamed segment with its range intact rather than guessed at.

### AbML, read and written

```ts
import { parseAbML, toAbML } from 'deneb/abml';

const { construct, diagnostics } = parseAbML('VH.a(1:6)-CH1(2:7){1}-H(3:10){2}-CH2(4:11)-CH3(5:12) | …');
const back = toAbML(construct);
```

[AbML v1.06](https://www.tandfonline.com/doi/full/10.1080/19420862.2022.2101183)
is a published one-line notation for antibody formats. Because it numbers its
domains and states outright which ones interact, reading it gives the pairing
this library would otherwise have to infer — which is what makes it worth
supporting rather than approximating.

The parser covers the whole grammar: domain tokens, the modification symbols
(`>` `@` `+` `_` `!` `^` and the general `*`), specificity letters, identifiers
and interactions, disulphide counts `{n}`, and the `ANTI` / `MOD` / `TYPE` /
`CLASS` / `LENGTH` / `NOTE` comments. Nothing is thrown for a molecule that
merely surprises it; anything assumed or not understood comes back in
`diagnostics`, and only a malformed expression raises `AbmlError`.

Two things do not survive a round trip, both because AbML cannot express them:

- **Named Fc mutations.** AbML records what a modification does, not which
  residues moved, so `lala` is written as its reserved effect keyword
  `MOD:NOADCCCDC` and reads back as that effect. Guessing L234A/L235A on the way
  in would put residue numbers in your figure that the source never stated.
- **One domain shared between chains.** AbML lets a chain reuse another chain's
  identifier; this model has no such thing, so the copies come back as separate
  domains paired with the original. The molecule is unchanged, the string is
  written a little more explicitly.

Specificity letters a source already uses are kept rather than reassigned, and
`ANTI` names survive both directions, so a string read in and written back out
is normally the same string.

### VERITAS, named and read

```ts
import { toVeritas, parseVeritas } from 'deneb/veritas';

const { name, notes } = toVeritas(construct);
// "[(CD3)Fab*(HER2)Fab]-heteroFc(KiH)"

const { construct: drawn } = parseVeritas('scFv-Fc-scFv');
```

[VERITAS](https://doi.org/10.1080/19420862.2023.2207232) (Verified Taxonomy for
Antibodies, Amgen) names a format around its multimerization centre:
`[N-terminal appendages]–centre–[C-terminal appendages]`, with `*` between
chains, `:` for a noncovalent pair, `(Target)` before a module and the
heterodimerization strategy after the centre.

`toVeritas` is the direction most people want: hand it a construct and it says
what the format is called. Every bundled preset gets a name, each name reads
back into a drawable molecule, and the name survives that round trip.

Where the paper expands a name, so does this. An arm whose light chain carries
an appendage cannot hide inside a `Fab`, so it becomes `…LC:Fd` over an `Fc`
centre rather than being called an IgG it is not; two arms binding different
targets become `[(A)Fab*(B)Fab]–heteroFc`. A molecule with no centre at all — a
BiTE, a diabody — is named by its modules, with the absence stated.

VERITAS is a name, not a construct: the scheme has no notation for linker
length, the hinge, isotype, conjugation or residue-level engineering. Reading a
name therefore fills those in with this library's defaults, and naming a
construct reports what the name had to leave out:

```ts
toVeritas(getPreset('adc-igg')).notes;
// ['VERITAS names architecture, not residue-level engineering: drug is not in the name.', …]
```

For anything richer than the architecture, use the DSL.

### The sequence, coloured like the diagram

```tsx
import { AntibodyViewer, AntibodySequence } from 'deneb/react';

<AntibodyViewer construct={spec} highlight={lit} onDomainHover={setHovered} />
<AntibodySequence construct={spec} highlight={lit} onResidueClick={inspect} />
```

Both take the same `highlight` vocabulary and put the same `data-domain-id` on
what they draw, so pointing at a domain in one lights it up in the other without
either knowing about the other. CDRs from `Domain.regions` are underlined.

## API

```ts
// deneb — model + notation
normalize(construct, { theme? }): NormalizedConstruct
parseDSL(source): Construct
stringifyDSL(construct): string

// geometry
layout(construct, { theme? }): LayoutResult

// rendering
buildScene(input, options): { scene, layout }
renderSVG(input, options): { svg, scene, layout }
renderLinear(input, options): { svg, scene, construct }
renderLegend(input, options): { svg, scene }
toSVGString(scene): string

// deneb/presets
presetNames(): string[]
getPreset(name): Construct

// deneb/lint
lint(construct, options?): LintFinding[]
LINT_RULES: readonly LintRule[]

// deneb/diff
diff(before, after): DiffResult

// deneb/panel
renderPanel(items, options?): { svg, scene }
renderComparison(before, after, options?): { svg, scene, changes }

// deneb/import
fromANARCI(csv, options?): { construct, diagnostics }
fromIgBLAST(airrTsv, options?): { construct, diagnostics }
identifyConstantRegion(sequence, from, kind, minIdentity?): ConstantMatch | null

// deneb/abml
parseAbML(source): { construct, diagnostics }
toAbML(construct, { multiline?, includeTargetNames? }): string

// deneb/veritas
parseVeritas(name): { construct, diagnostics }
toVeritas(construct, { includeTargets?, includeStrategy? }): { name, notes }
```

The React components take `construct` or `dsl`. There is no `preset` prop:
resolving one would tie every page that renders a diagram to the whole preset
catalogue. Pass `construct={getPreset('igg-kih')}` instead.

## Presets

**Fc-based IgG heterodimers** `igg1` `igg1-lala` `igg-kih` `igg-kih-lala`
`common-lc-kih` `crossmab-ch1cl` `crossmab-fab` `duobody` `charge-pair-igg`
`duetmab` `two-in-one-igg`

**Conjugates and Fc engineering** `adc-igg` `adc-thiomab` `adc-noncleavable`
`igg-glycan` `igg-afucosyl` `igg-long-half-life` `igg4-s228p` `pegylated-fab`
`tagged-scfv`

**Fragments** `fab` `fab2` `scfv` `bite` `hle-bite` `diabody` `dart` `dart-fc`
`tandab` `vhh` `tandem-vhh` `biparatopic-vhh-fc`

**Fc fusions and appended IgGs** `scfv-fc` `scfv-fc-kih` `dvd-ig` `tvd-ig`
`codv-ig` `igg-hc-scfv` `igg-lc-scfv` `vhh-igg` `vhh-igg-kih` `scfv-igg-kih`
`vhh-lc-igg` `scfv4-ig` `trispecific-igg-scfv`

**Non-Ig fusions** `scfv2-albumin` `scfv-toxin` `immtac` `igg-cytokine`

They double as the regression corpus: every one is snapshot-tested and drawn
into the gallery.

## Development

```sh
npm install
npm test          # unit tests + SVG snapshots + React/string parity
npm run build     # ESM + CJS + type declarations
npm run playground   # build, then serve and open examples/playground.html
npm run readme-images  # rebuild docs/images/ (needs Playwright for the PNGs)
npm run gallery      # build, then write examples/gallery.html
npm run adc-demo     # build, then write examples/adc.html
npm run panel-demo   # build, then write examples/panel.html
npm run size         # what each entry point costs, and a check that the
                     # viewer has not picked the optional areas back up
npm run check-exports  # compile a throwaway consumer against every subpath
                       # under NodeNext + strict, so a malformed exports map
                       # fails here rather than in someone else's project
npm run constant-regions   # refetch the UniProt reference data
```

`scripts/adc-demo.mjs` shows the whole conjugate path end to end: it turns a
SMILES string into a depiction with OpenChemLib — a devDependency of this repo,
never of the library — and hands the result to `payload.structure`. The molecules
it ships are example stand-ins; swap in your payload's SMILES and the drawings
follow.

## Prior art

[AbML and abYdraw](https://www.tandfonline.com/doi/full/10.1080/19420862.2022.2101183)
are a published notation and renderer for antibody formats; AbML is read and
written here through `deneb/abml`.
[VERITAS](https://doi.org/10.1080/19420862.2023.2207232) is Amgen's naming
scheme for the same formats, through `deneb/veritas`. The two answer
different questions — AbML writes the molecule, VERITAS names the architecture.
[BioGlyph](https://bioglyph.app/) covers the same ground commercially.

## License

[PolyForm Noncommercial 1.0.0](../LICENSE). Free for research, teaching, personal
projects, and use by charities, educational institutions, public research
organizations and government bodies. **Commercial use requires a separate
licence** — ask.

Note that this is a source-available licence, not an OSI-approved open-source
one, and some organizations' policies treat the two differently.

The bundled constant-region sequences are derived from UniProt (CC BY 4.0);
their accessions are recorded in `src/import/constant-regions.ts`.
