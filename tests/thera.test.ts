import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalize } from '../src/model/normalize';
import { layout } from '../src/layout/skeleton';
import { renderSVG } from '../src/render/svg';
import { resolvePairing } from '../src/edit/pairing';
import {
  fromTheraSAbDab,
  parseTheraSAbDabCsv,
  THERA_FORMATS,
  THERA_FORMAT_RULES,
  type TheraSAbDabRecord,
} from '../src/import/thera';

/**
 * Real rows, quoted verbatim from the Thera-SAbDab download — one per format
 * this reader covers, plus three it declines. Regenerate with
 * `node scripts/fetch-thera.mjs --sample`.
 *
 * Source: https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/therasabdab/
 */
const ROWS = parseTheraSAbDabCsv(
  readFileSync(new URL('./fixtures/thera-sample.csv', import.meta.url), 'utf8'),
);
const by = (name: string): TheraSAbDabRecord => ROWS.find((r) => r['Therapeutic'] === name)!;

describe('parseTheraSAbDabCsv', () => {
  it('reads the download as the database writes it', () => {
    expect(ROWS.length).toBeGreaterThan(15);
    expect(Object.keys(ROWS[0]!)).toContain('CH1 Isotype');
    expect(by('Abciximab')['Format']).toBe('Fab');
  });

  it('keeps commas and quotes inside a field', () => {
    // Targets carry slashes and semicolons; conditions carry commas.
    expect(by('Acasunlimab')['Target']).toContain(';');
    for (const row of ROWS) expect(row['Therapeutic']).not.toContain(',');
  });
});

describe('fromTheraSAbDab', () => {
  it('covers one row of every format it claims to', () => {
    for (const format of THERA_FORMATS) {
      const row = ROWS.find((r) => r['Format'] === format);
      expect(row, `no sample row for "${format}"`).toBeTruthy();
      expect(fromTheraSAbDab(row!).construct.chains.length).toBeGreaterThan(0);
    }
  });

  it.each(ROWS.filter((r) => THERA_FORMATS.includes(r['Format'] ?? '')).map((r) => [r['Therapeutic']!, r] as const))(
    'draws %s without a guess left in it',
    (_name, row) => {
      const { construct } = fromTheraSAbDab(row);
      const normalized = normalize(construct, { pairing: 'explicit' });
      const report = resolvePairing(normalized);
      expect(report.ambiguous).toEqual([]);
      expect(report.unresolved).toEqual([]);

      const placed = layout(normalized);
      const ids = placed.domains.map((p) => p.domain.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(() => renderSVG(normalized)).not.toThrow();
    },
  );

  it('takes the name, the target and the isotype from the row', () => {
    const { construct } = fromTheraSAbDab(by('Abagovomab'));
    expect(construct.name).toBe('Abagovomab');
    const heavy = construct.chains.find((c) => c.id === 'HC')!;
    expect(heavy.domains[0]!.specificity).toBe('MUC16');
    expect(heavy.domains[0]!.isotype).toBe('IgG1');
    // The full target string is kept, so nothing is lost to the short label.
    expect(heavy.domains[0]!.notes).toEqual(['MUC16/CA125']);
  });

  it('does not put the heavy chain class on the light chain', () => {
    // `CH1 Isotype` describes the heavy chain; `VD LC` describes the light one.
    const { construct } = fromTheraSAbDab(by('Abagovomab'));
    const light = construct.chains.find((c) => c.id === 'LC')!;
    expect(light.domains.map((d) => d.isotype)).toEqual([undefined, 'kappa']);
  });

  it('gives a bispecific two different arms and no invented pairing design', () => {
    const { construct, diagnostics } = fromTheraSAbDab(by('Acasunlimab'));
    const targets = construct.chains.flatMap((c) =>
      c.domains.map((d) => d.specificity).filter(Boolean),
    );
    expect(new Set(targets).size).toBe(2);
    // Nothing was added to make the chains prefer each other, because the
    // database does not record how they were made to.
    const mods = construct.chains.flatMap((c) => c.domains.flatMap((d) => d.modifications ?? []));
    expect(mods).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toContain('thera-not-stated');
  });

  it('quotes the ADC payload from the row rather than looking it up', () => {
    const { construct, diagnostics } = fromTheraSAbDab(by('Anetumab'));
    const payloads = construct.chains
      .flatMap((c) => c.domains.flatMap((d) => d.modifications ?? []))
      .map((m) => m.payload?.name);
    expect(payloads).toEqual(['ravtansine']);
    // And says out loud that the site is a place to draw it, not a claim.
    expect(diagnostics.some((d) => /conjugation site is not recorded/.test(d.message))).toBe(true);
  });

  it('declines a format it cannot read, and says why', () => {
    const { construct, diagnostics } = fromTheraSAbDab(by('Acimtamig'));
    expect(construct.chains).toEqual([]);
    expect(diagnostics[0]!.level).toBe('error');
    expect(diagnostics[0]!.code).toBe('thera-format-unread');
  });

  it('never throws, whatever the row says', () => {
    for (const row of [...ROWS, {}, { Format: 'Whole mAb' }, { Therapeutic: 'x', Format: '' }]) {
      expect(() => fromTheraSAbDab(row), JSON.stringify(row['Therapeutic'])).not.toThrow();
    }
  });

  it('says when it cannot read an isotype instead of inventing one', () => {
    const { construct, diagnostics } = fromTheraSAbDab({
      Therapeutic: 'Test',
      Format: 'Whole mAb',
      'CH1 Isotype': 'G9',
      'VD LC': 'Kappa',
      Target: 'X',
    });
    expect(construct.chains[0]!.domains[0]!.isotype).toBeUndefined();
    expect(diagnostics.map((d) => d.code)).toContain('thera-isotype-unread');
  });

  it('states a caveat for every shape it had to choose', () => {
    for (const rule of THERA_FORMAT_RULES) {
      if (!rule.caveat) continue;
      const row = ROWS.find((r) => r['Format'] === rule.format)!;
      const { diagnostics } = fromTheraSAbDab(row);
      expect(diagnostics.map((d) => d.message)).toContain(rule.caveat);
    }
  });
});
