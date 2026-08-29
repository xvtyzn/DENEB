# DENEB

[![CI](https://github.com/xvtyzn/DENEB/actions/workflows/ci.yml/badge.svg)](https://github.com/xvtyzn/DENEB/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-2f6f5e)](LICENSE)
![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=nodedotjs&logoColor=white)
![TypeScript 5.7+](https://img.shields.io/badge/TypeScript-5.7%2B-3178C6?logo=typescript&logoColor=white)
![Core gzip: 26 kB](https://img.shields.io/badge/core_gzip-26_kB-555555)

**D**rawing **E**ngine for **N**otated, **E**ngineered **B**iologics

[日本語](README.ja.md) · [Full reference](docs/reference.md)

DENEB turns a declarative antibody construct into an embeddable SVG diagram.
It handles conventional IgGs, bispecifics, fragments, Fc fusions, ADCs and
non-immunoglobulin fusions while keeping target colours and engineering marks
consistent.

![Six antibody formats drawn from the same palette](docs/images/formats.png)

> DENEB visualises an annotation; it does not infer one from a sequence. Feed it
> the output of your own HMM, ML or annotation pipeline.

## Highlights

- Framework-agnostic core with zero runtime dependencies; works in browsers,
  Node, SSR and static export.
- React components render the same Scene as real SVG elements, so domain events
  remain available without injecting the complete SVG as HTML.
- Cartoon, linear architecture and standalone legend views.
- 49 presets covering common bispecific, fragment, Fc-fusion and ADC formats.
- Optional lint, diff, panel, sequence-import, AbML and VERITAS entry points.

## Install

```sh
npm install deneb
```

`react` and `react-dom` are optional peer dependencies required only by
`deneb/react`.

## Quick Start

```ts
import { renderSVG, type Construct } from 'deneb';

const spec: Construct = {
  name: 'anti-HER2 IgG1',
  chains: [
    {
      id: 'HC',
      copies: 2,
      domains: [
        { type: 'VH', specificity: 'HER2' },
        { type: 'CH1' },
        { type: 'hinge' },
        { type: 'CH2' },
        { type: 'CH3' },
      ],
    },
    {
      id: 'LC',
      copies: 2,
      domains: [{ type: 'VL', specificity: 'HER2' }, { type: 'CL' }],
    },
  ],
};

const { svg, layout } = renderSVG(spec);
```

In React:

```tsx
import { AntibodyViewer } from 'deneb/react';

<AntibodyViewer
  construct={spec}
  colorMode="specificity"
  highlight={['spec:HER2']}
  onDomainClick={(info) => console.log(info.domain.id)}
  renderTooltip={(info) => <>{info.domain.label}</>}
/>
```

For a bundled format, resolve the preset explicitly so applications that do not
need the catalogue do not load it:

```ts
import { renderSVG } from 'deneb';
import { getPreset } from 'deneb/presets';

const { svg } = renderSVG(getPreset('igg-kih'));
```

## Inputs And Views

Structured `Construct` objects are the primary input. A compact DSL is useful
for fixtures and hand-written designs:

```ts
import { parseDSL, renderSVG } from 'deneb';

const construct = parseDSL(`
  @name IgG(kih) 1+1 bispecific
  HC1: VH(CD3)-CH1-h-CH2[lala]-CH3[knob]
  LC1: VL(CD3)-CL
  HC2: VH(HER2)-CH1-h-CH2[lala]-CH3[hole]
  LC2: VL(HER2)-CL
`);

const { svg } = renderSVG(construct);
```

| View | Function | React component | Best for |
| --- | --- | --- | --- |
| Cartoon | `renderSVG` | `<AntibodyViewer>` | Format and pairing at a glance |
| Linear | `renderLinear` | `<AntibodyLinear>` | Domain order and residue positions |
| Legend | `renderLegend` | `<AntibodyLegend>` | Reusable figure legends |

Domains expose `data-domain-*` attributes and can be highlighted by domain,
chain, specificity or modification. Conjugated payloads can use built-in glyphs
or trusted chemical artwork. Inline `payload.structure.svg` is inserted
verbatim and unsanitised; use `href` for user-supplied artwork.

## Optional Entry Points

| Import | Purpose |
| --- | --- |
| `deneb/react` | React viewers and sequence view |
| `deneb/presets` | Bundled construct catalogue |
| `deneb/lint` | Design checks with highlightable references |
| `deneb/diff` | Parent/variant comparison |
| `deneb/panel` | Multi-molecule figures |
| `deneb/import` | ANARCI and IgBLAST adapters |
| `deneb/abml` | AbML v1.06 reader and writer |
| `deneb/veritas` | VERITAS name reader and writer |

The core entry is about 26 kB gzipped and is checked not to pull these optional
areas into viewer-only applications.

## Try It

From a clone of this repository:

```sh
npm install
npm run playground
```

This serves [`examples/playground.html`](examples/playground.html), where the DSL
or AbML definition, design findings and both views update together. Use
`npm run gallery` to generate a standalone gallery of all presets.

## Documentation

The [full reference](docs/reference.md) covers inference rules, layout,
modifications, ADC structures, interaction, design checks, comparison panels,
sequence import, AbML, VERITAS, the API, presets and development commands.

The complete Japanese reference is available in
[`docs/reference.ja.md`](docs/reference.ja.md).

## License

[PolyForm Noncommercial 1.0.0](LICENSE). Research, teaching, personal projects
and qualifying noncommercial organizations are covered; commercial use requires
a separate licence. This is a source-available licence, not an OSI-approved
open-source licence.

Bundled constant-region sequences are derived from UniProt under CC BY 4.0;
accessions are recorded in `src/import/constant-regions.ts`.
