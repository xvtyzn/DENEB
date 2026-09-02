import type { Chain, Construct, Diagnostic, Domain, DomainType, Modification } from '../model/types';
import type { ImportResult } from './types';

/**
 * One row of the Thera-SAbDab download, keyed by its column headings.
 *
 * Only `Therapeutic`, `Format`, `CH1 Isotype`, `VD LC`, `Target` and `Notes`
 * are read; the rest of the row is carried by the caller if it wants it.
 */
export interface TheraSAbDabRecord {
  readonly [column: string]: string | undefined;
}

/** One arm of a molecule, as the database describes it. */
interface Arm {
  specificity?: string;
  isotype?: string;
  lightClass?: string;
  /** The target string as written, synonyms and all. */
  targetNote?: string;
}

// --- reading the download ---------------------------------------------------

/**
 * Read the CSV Thera-SAbDab hands out.
 *
 * Written here rather than taken as a dependency because the file is small and
 * regular, and because an importer that needs a parser to be installed
 * alongside it is not much of an importer. Quotes, embedded commas and embedded
 * newlines are handled; nothing else is.
 */
export function parseTheraSAbDabCsv(csv: string): TheraSAbDabRecord[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const text = csv.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') (row.push(field), (field = ''));
    else if (ch === '\n') (row.push(field), rows.push(row), (row = []), (field = ''));
    else field += ch;
  }
  if (field !== '' || row.length > 0) (row.push(field), rows.push(row));

  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((r) => r.some((cell) => cell.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((name, i) => [name.trim(), r[i] ?? ''])));
}

// --- the vocabularies the database uses -------------------------------------

/**
 * `CH1 Isotype` as written, to the isotype this model records.
 *
 * The database writes the heavy-chain class alone (`G1`), so these are read as
 * IgG subclasses. Tokens it uses for anything else — `na`, or the occasional
 * shifted cell — are left unnamed rather than guessed at.
 */
const ISOTYPES: Record<string, string> = {
  G1: 'IgG1',
  G2: 'IgG2',
  G3: 'IgG3',
  G4: 'IgG4',
  A1: 'IgA1',
  E: 'IgE',
  M: 'IgM',
  G2a: 'IgG2a',
  G2b: 'IgG2b',
};

const LIGHT_CLASSES: Record<string, string> = { Kappa: 'kappa', Lambda: 'lambda' };

/** `FOLH1/GCPII/PSMA` reads better on a diagram as `FOLH1`. */
const shortTarget = (target: string): string | undefined =>
  target.split('/')[0]?.trim() || undefined;

const split = (value: string | undefined): string[] =>
  (value ?? '').split(';').map((part) => part.trim());

function armsOf(record: TheraSAbDabRecord, diagnostics: Diagnostic[]): Arm[] {
  const targets = split(record['Target']);
  const isotypes = split(record['CH1 Isotype']);
  const classes = split(record['VD LC']);
  const count = Math.max(targets.length, isotypes.length, classes.length, 1);

  const arms: Arm[] = [];
  for (let i = 0; i < count; i++) {
    const rawIsotype = isotypes[i] ?? isotypes[0] ?? '';
    const rawClass = classes[i] ?? classes[0] ?? '';
    if (rawIsotype && rawIsotype !== 'na' && !ISOTYPES[rawIsotype]) {
      diagnostics.push({
        level: 'info',
        code: 'thera-isotype-unread',
        message: `The isotype is written "${rawIsotype}", which is not one this reader knows; it was left off.`,
      });
    }
    const arm: Arm = {};
    const target = targets[i];
    if (target && target !== 'na') {
      arm.specificity = shortTarget(target);
      arm.targetNote = target;
    }
    const isotype = ISOTYPES[rawIsotype];
    if (isotype) arm.isotype = isotype;
    const lightClass = LIGHT_CLASSES[rawClass];
    if (lightClass) arm.lightClass = lightClass;
    arms.push(arm);
  }
  return arms;
}

// --- building chains --------------------------------------------------------

function domain(type: DomainType, arm: Arm, opts: { variable?: boolean } = {}): Domain {
  const d: Domain = { type };
  if (opts.variable && arm.specificity) d.specificity = arm.specificity;
  if (opts.variable && arm.targetNote && arm.targetNote !== arm.specificity) {
    d.notes = [arm.targetNote];
  }
  if (arm.isotype) d.isotype = arm.isotype;
  return d;
}

const heavyFab = (arm: Arm): Domain[] => [
  domain('VH', arm, { variable: true }),
  domain('CH1', arm),
];
const fc = (arm: Arm): Domain[] => [domain('hinge', arm), domain('CH2', arm), domain('CH3', arm)];
const lightChain = (arm: Arm): Domain[] => {
  // `CH1 Isotype` is the heavy chain's class and says nothing about the light
  // chain, whose own class is in `VD LC`. Stamping the one onto the other made
  // an IgG4 molecule look like it had IgG4 light chains.
  const vl = domain('VL', { ...arm, isotype: undefined }, { variable: true });
  const cl: Domain = { type: 'CL' };
  if (arm.lightClass) cl.isotype = arm.lightClass;
  return [vl, cl];
};
const scFv = (arm: Arm): Domain[] => [
  domain('VH', arm, { variable: true }),
  { type: 'linker' },
  domain('VL', { ...arm, isotype: undefined }, { variable: true }),
];

function wholeMab(arms: Arm[], tail: Domain[] = []): Chain[] {
  const arm = arms[0] ?? {};
  return [
    { id: 'HC', kind: 'heavy', copies: 2, domains: [...heavyFab(arm), ...fc(arm), ...tail] },
    { id: 'LC', kind: 'light', copies: 2, domains: lightChain(arm) },
  ];
}

/**
 * Two different arms on one Fc.
 *
 * Nothing is added to make them prefer each other: the database records that a
 * molecule is bispecific, not how its heavy chains were made to heterodimerize.
 * `deneb/lint` will say `homodimer-risk`, which is the correct thing to say
 * about a description that does not mention one.
 */
function bispecificMab(arms: Arm[], tail: (arm: Arm) => Domain[] = () => []): Chain[] {
  return arms.flatMap((arm, i) => [
    {
      id: `HC${i + 1}`,
      kind: 'heavy' as const,
      domains: [...heavyFab(arm), ...fc(arm), ...tail(arm)],
    },
    { id: `LC${i + 1}`, kind: 'light' as const, domains: lightChain(arm) },
  ]);
}

// --- the format table -------------------------------------------------------

export interface TheraFormatRule {
  /** The `Format` value, exactly as the database writes it. */
  format: string;
  /** How many arms the shape needs; `2` means the row must be bispecific. */
  arms: 1 | 2;
  build(arms: Arm[], record: TheraSAbDabRecord, diagnostics: Diagnostic[]): Chain[];
  /** Said out loud whenever this rule is used, because the source does not say it. */
  caveat?: string;
}

/** `ADC with vedotin` — the compound, quoted from the row rather than looked up. */
function payloadFromNotes(record: TheraSAbDabRecord): Modification {
  const named = /ADC with ([A-Za-z][A-Za-z0-9-]*)/.exec(record['Notes'] ?? '');
  return { type: 'drug', payload: named?.[1] ? { name: named[1] } : {} };
}

/**
 * A conjugate, drawn on CH2 because it has to be drawn somewhere.
 *
 * The database records that a molecule is an ADC and, sometimes, what the
 * compound is. It does not record the conjugation site, so the position of the
 * mark is a place to put it and not a claim about which residue carries it.
 */
function conjugated(arms: Arm[], record: TheraSAbDabRecord): Chain[] {
  const chains = wholeMab(arms);
  const ch2 = chains[0]!.domains.find((d) => d.type === 'CH2')!;
  ch2.modifications = [payloadFromNotes(record)];
  return chains;
}

const FUSION_PARTNER: Domain = { type: 'custom', label: 'fusion partner' };

export const THERA_FORMAT_RULES: readonly TheraFormatRule[] = [
  { format: 'Whole mAb', arms: 1, build: (a) => wholeMab(a) },
  { format: 'Whole mAb (Mouse)', arms: 1, build: (a) => wholeMab(a) },
  { format: 'Canine Whole mAb', arms: 1, build: (a) => wholeMab(a) },
  { format: 'Feline Whole mAb', arms: 1, build: (a) => wholeMab(a) },
  {
    format: 'Whole mAb ADC',
    arms: 1,
    build: (a, record) => conjugated(a, record),
    caveat: 'The conjugation site is not recorded, so the mark is placed on CH2 rather than where the chemistry actually is.',
  },
  {
    format: 'Whole mAb Radiolabelled',
    arms: 1,
    build: (a, record) => conjugated(a, record),
    caveat: 'The label and its site are not recorded; the mark stands for the conjugate, not for a position.',
  },
  {
    format: 'Whole mAb Fusion',
    arms: 1,
    build: (a) => wholeMab(a, [{ type: 'linker' }, { ...FUSION_PARTNER }]),
    caveat: 'The source says a partner is fused but not what it is or where, so it is drawn unnamed at the C-terminus.',
  },
  { format: 'Fab', arms: 1, build: (a) => [
      { id: 'HC', kind: 'heavy', domains: heavyFab(a[0] ?? {}) },
      { id: 'LC', kind: 'light', domains: lightChain(a[0] ?? {}) },
    ] },
  { format: 'scFv', arms: 1, build: (a) => [{ id: 'C1', kind: 'single', domains: scFv(a[0] ?? {}) }] },
  { format: 'Bispecific mAb', arms: 2, build: (a) => bispecificMab(a),
    caveat: 'How the two heavy chains were made to pair is not recorded, so no heterodimerization design is drawn.' },
  { format: 'Bispecific Whole mAb', arms: 2, build: (a) => bispecificMab(a),
    caveat: 'How the two heavy chains were made to pair is not recorded, so no heterodimerization design is drawn.' },
  {
    format: 'Bispecific mAb with Domain Crossover',
    arms: 2,
    build: (a) => bispecificMab(a),
    caveat: 'The source says the domains are crossed over but not at which interface (Fab, CH1-CL or VH-VL), so the crossover is not drawn.',
  },
  {
    format: 'Bispecific scFv',
    arms: 2,
    build: (a) => [
      {
        id: 'C1',
        kind: 'single',
        domains: [...scFv(a[0] ?? {}), { type: 'linker' }, ...scFv(a[1] ?? {})],
      },
    ],
  },
  {
    format: 'Bispecific Dual Variable Domain IG',
    arms: 2,
    build: (a) => {
      const [outer, inner] = [a[0] ?? {}, a[1] ?? {}];
      return [
        {
          id: 'HC',
          kind: 'heavy',
          copies: 2,
          domains: [
            domain('VH', outer, { variable: true }),
            { type: 'linker' },
            domain('VH', inner, { variable: true }),
            domain('CH1', inner),
            ...fc(inner),
          ],
        },
        {
          id: 'LC',
          kind: 'light',
          copies: 2,
          domains: [
            domain('VL', outer, { variable: true }),
            { type: 'linker' },
            ...lightChain(inner),
          ],
        },
      ];
    },
    caveat: 'Which specificity sits on the outside is not recorded; the first target listed is drawn there.',
  },
  {
    format: "Bispecific Single Domains (VH-VH')",
    arms: 2,
    build: (a) => [
      {
        id: 'C1',
        kind: 'single',
        domains: [
          domain('VHH', a[0] ?? {}, { variable: true }),
          { type: 'linker' },
          domain('VHH', a[1] ?? {}, { variable: true }),
        ],
      },
    ],
  },
  {
    format: 'Bispecific Mixed mAb and scFv',
    arms: 2,
    build: (a) => {
      const [igg, appended] = [a[0] ?? {}, a[1] ?? {}];
      return [
        {
          id: 'HC',
          kind: 'heavy',
          copies: 2,
          domains: [...heavyFab(igg), ...fc(igg), { type: 'linker' }, ...scFv(appended)],
        },
        { id: 'LC', kind: 'light', copies: 2, domains: lightChain(igg) },
      ];
    },
    caveat: 'Where the scFv is attached — the heavy chain, the light chain, either terminus — is not recorded; it is drawn at the heavy chain C-terminus.',
  },
];

const RULES = new Map(THERA_FORMAT_RULES.map((rule) => [rule.format, rule]));

/** Every `Format` value this reader draws, for a caller that wants to filter first. */
export const THERA_FORMATS: readonly string[] = THERA_FORMAT_RULES.map((r) => r.format);

// --- the reader -------------------------------------------------------------

/**
 * Turn one Thera-SAbDab row into something drawable.
 *
 * The database is the WHO's list of antibody therapeutics, and its `Format`
 * column is the closest thing the field has to a controlled vocabulary for
 * architecture. Most of it is regular — a handful of values account for the
 * great majority of rows — and those are read here. The long tail is written
 * as free text describing one molecule each, and is reported rather than
 * guessed at: `Bispecific ((G1_L-kappa)_scFv-G1(h-CH2-CH3))` says exactly what
 * one therapeutic is and nothing about how to read the next one.
 *
 * Never throws. What the source did not say comes back in `diagnostics`,
 * including the places where a shape had to be chosen to draw anything at all.
 *
 * Download: https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/therasabdab/
 */
export function fromTheraSAbDab(record: TheraSAbDabRecord): ImportResult {
  const diagnostics: Diagnostic[] = [];
  const name = (record['Therapeutic'] ?? '').trim();
  const format = (record['Format'] ?? '').trim();
  const construct: Construct = { chains: [] };
  if (name) construct.name = name;

  const rule = RULES.get(format);
  if (!rule) {
    diagnostics.push({
      level: 'error',
      code: 'thera-format-unread',
      message:
        `"${format || '(blank)'}" is not one of the ${THERA_FORMAT_RULES.length} formats this reader ` +
        `covers, so nothing was drawn. The long tail of the column is free text describing a single ` +
        `molecule, and reading it by pattern would invent architecture the source does not state.`,
    });
    return { construct, diagnostics };
  }

  const arms = armsOf(record, diagnostics);
  if (rule.arms === 2 && arms.length < 2) {
    diagnostics.push({
      level: 'error',
      code: 'thera-arms-missing',
      message: `"${format}" needs two arms, but the row describes ${arms.length}. Nothing was drawn.`,
    });
    return { construct, diagnostics };
  }

  construct.chains = rule.build(arms, record, diagnostics);
  if (rule.caveat) {
    diagnostics.push({ level: 'info', code: 'thera-not-stated', message: rule.caveat });
  }
  return { construct, diagnostics };
}
