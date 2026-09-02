import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { buildScene } from '../src/render/scene';
import { renderSVG } from '../src/render/svg';
import { AntibodyViewer } from '../src/react/AntibodyViewer';
import { modificationFromEvent } from '../src/react/events';
import { normalize } from '../src/model/normalize';
import { parseDSL } from '../src/dsl/parse';
import { getPreset, getTemplate } from '../src/presets/index';
import { applyEdit } from '../src/edit/ops';
import { useConstructEditor } from '../src/react/editor';

const ADC = `
  HC: VH(HER2)-CH1-h-CH2[drug=MMAE/vc-PAB/4/2/interchain cysteine]-CH3 *2
  LC: VL(HER2)-CL *2
`;

describe('interactive scenes', () => {
  it('leaves the ordinary drawing untouched', () => {
    const plain = renderSVG(parseDSL(ADC)).svg;
    expect(plain).not.toContain('data-modification-index');
    expect(plain).toContain('pointer-events="none"');
  });

  it('lets a conjugation site be clicked, and says which one it is', () => {
    const svg = renderSVG(parseDSL(ADC), { interactiveMarkers: true }).svg;
    expect(svg).toContain('data-modification-index="0"');
    // The marks no longer decline the pointer.
    const marks = svg.match(/class="dn-marker"[^>]*/g) ?? [];
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) expect(mark).not.toContain('pointer-events="none"');
  });

  it('gives a hinge an element to click even with nothing on it', () => {
    const plain = renderSVG(getPreset('igg1')).svg;
    const interactive = renderSVG(getPreset('igg1'), { interactiveMarkers: true }).svg;
    expect(plain).not.toContain('data-domain-id="HC:2"');
    expect(interactive).toContain('data-domain-id="HC:2"');
  });

  it('hands back what the molecule is translated by', () => {
    const { transform, scene } = buildScene(getPreset('igg1'));
    expect(Number.isFinite(transform.x)).toBe(true);
    expect(Number.isFinite(transform.y)).toBe(true);
    expect(JSON.stringify(scene)).toContain(
      `translate(${Math.round(transform.x * 100) / 100},${Math.round(transform.y * 100) / 100})`,
    );
  });

  it('resolves a click to one modification out of several', () => {
    const construct = normalize(
      parseDSL('HC: VH(X)-CH1[drug=MMAE, drug=DXd]\nLC: VL(X)-CL'),
    );
    const element = {
      closest: (selector: string) => (selector.includes('modification-type') ? element : null),
      getAttribute: (name: string) =>
        ({ 'data-modification-type': 'drug', 'data-modification-index': '1' })[name] ?? 'HC:1',
    };
    const info = modificationFromEvent(element as never, construct);
    expect(info?.modification.payload?.name).toBe('DXd');
    expect(info?.modification.index).toBe(1);
  });
});

describe('useConstructEditor', () => {
  it('holds an expanded document, a decided molecule and a list of findings', () => {
    let seen: { chains: number; pairs: number; findings: string[] } | null = null;
    function Probe() {
      const editor = useConstructEditor({ initial: getTemplate('igg1') });
      seen = {
        chains: editor.construct.chains.length,
        pairs: editor.pairing.resolved.length,
        findings: editor.findings.map((f) => f.rule),
      };
      return createElement(AntibodyViewer, { construct: editor.resolved });
    }
    const markup = renderToStaticMarkup(createElement(Probe));
    expect(markup).toContain('data-domain-id="HC:0"');
    // `copies: 2` has become real chains, and the pairing is settled.
    expect(seen!.chains).toBe(4);
    expect(seen!.pairs).toBe(12);
    expect(seen!.findings).toEqual([]);
  });

  it('reports what a half-made edit is still missing', () => {
    const half = applyEdit(getTemplate('igg1'), {
      op: 'insert-domain',
      at: { chain: 'LC', index: 2 },
      domain: { type: 'VH', specificity: 'CD3' },
      mirror: true,
    }).construct;
    let rules: string[] = [];
    function Probe() {
      rules = useConstructEditor({ initial: half }).findings.map((f) => f.rule);
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(rules).toContain('unpaired-variable-domain');
  });
});

describe('AntibodyViewer editing props', () => {
  it('rings the selection without disturbing highlight', () => {
    const markup = renderToStaticMarkup(
      createElement(AntibodyViewer, { construct: getPreset('igg1'), selection: ['HC:0'] }),
    );
    expect(markup).toContain('dn-highlight');
  });

  it('takes a tabIndex through to the svg', () => {
    const markup = renderToStaticMarkup(
      createElement(AntibodyViewer, { construct: getPreset('igg1'), tabIndex: 0 }),
    );
    expect(markup).toContain('tabindex="0"');
  });
});
