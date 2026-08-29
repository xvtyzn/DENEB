import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildScene, renderLinear, toSVGString } from '../src/index';
import { AntibodyLegend, AntibodyLinear, AntibodyViewer, SceneSvg } from '../src/react/index';
import { domainFromEvent, modificationFromEvent } from '../src/react/events';
import { normalize } from '../src/index';
import { getPreset, presetNames } from '../src/presets/index';

/**
 * Both renderers are driven by the same `Scene`, so their markup must agree.
 * The comparison is structural — tag name plus a sorted attribute map — because
 * the two serializers differ only in whitespace and attribute order.
 */
function canonicalise(markup: string): string {
  return markup
    // React writes leaf elements with an explicit closing tag and escapes
    // apostrophes; neither changes the rendered document.
    .replace(/<\/(path|rect|circle|line|image)>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/<(\w+)((?:\s+[\w:-]+="[^"]*")*)\s*\/?>/g, (_all, tag: string, attrs: string) => {
      const pairs = [...attrs.matchAll(/([\w:-]+)="([^"]*)"/g)]
        .map(([, k, v]) => `${k}=${v}`)
        .sort();
      return `<${tag} ${pairs.join(' ')}>`;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

describe('React and string renderers agree', () => {
  it.each(presetNames())('%s produces identical markup', (name) => {
    const { scene } = buildScene(getPreset(name));
    const fromString = toSVGString(scene);
    const fromReact = renderToStaticMarkup(<SceneSvg scene={scene} />);
    expect(canonicalise(fromReact)).toBe(canonicalise(fromString));
  });

  it('agrees on an embedded structure depiction', () => {
    const construct = {
      chains: [
        {
          id: 'C1',
          domains: [
            {
              type: 'VHH' as const,
              specificity: 'X',
              modifications: [
                {
                  type: 'drug' as const,
                  payload: {
                    name: 'MMAE',
                    structure: { svg: '<circle cx="5" cy="5" r="4"></circle>', viewBox: '0 0 10 10' },
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    for (const mode of ['legend', 'inline'] as const) {
      const { scene } = buildScene(construct, { showStructures: mode });
      expect(canonicalise(renderToStaticMarkup(<SceneSvg scene={scene} />))).toBe(
        canonicalise(toSVGString(scene)),
      );
    }
  });

  it('agrees on the linear view too', () => {
    const { scene, svg } = renderLinear(getPreset('igg-kih'));
    expect(canonicalise(renderToStaticMarkup(<SceneSvg scene={scene} />))).toBe(canonicalise(svg));
  });
});

describe('components', () => {
  it('accepts a construct or a DSL string', () => {
    const fromConstruct = renderToStaticMarkup(<AntibodyViewer construct={getPreset('scfv')} />);
    const fromDsl = renderToStaticMarkup(
      <AntibodyViewer dsl={'@name scFv\nC1: VH(HER2)~VL(HER2)'} />,
    );
    expect(canonicalise(fromDsl)).toBe(canonicalise(fromConstruct));
  });

  it('points at the presets entry when no source is given', () => {
    expect(() => renderToStaticMarkup(<AntibodyViewer />)).toThrow(
      /deneb\/presets/,
    );
  });

  it('passes scene options through', () => {
    const markup = renderToStaticMarkup(
      <AntibodyViewer construct={getPreset('igg-kih')} showLegend={false} highlight={['mod:knob']} />,
    );
    expect(markup).not.toContain('dn-legend');
    expect(markup).toContain('dn-highlight');
  });

  it('renders the linear and legend components', () => {
    expect(renderToStaticMarkup(<AntibodyLinear construct={getPreset('igg-kih')} />)).toContain(
      'dn-linear-domain',
    );
    expect(renderToStaticMarkup(<AntibodyLegend construct={getPreset('igg-kih')} />)).toContain(
      'Targets',
    );
  });

  it('does not run onRender as a side effect of server rendering', () => {
    let captured = '';
    renderToStaticMarkup(
      <AntibodyViewer construct={getPreset('scfv')} onRender={(svg) => (captured = svg)} />,
    );
    expect(captured).toBe('');
  });
});

/** A minimal stand-in for the parts of the DOM the event helpers touch. */
function fakeElement(attrs: Record<string, string>, ancestors: Record<string, string>[] = []) {
  const self = {
    attrs,
    getAttribute: (name: string) => attrs[name] ?? null,
    closest(selector: string): unknown {
      const key = selector.slice(1, -1);
      for (const candidate of [attrs, ...ancestors]) {
        if (key in candidate) {
          return candidate === attrs ? self : fakeElement(candidate);
        }
      }
      return null;
    },
  };
  return self;
}

describe('event helpers', () => {
  const construct = normalize(getPreset('igg-kih'));

  it('resolves the domain under the pointer', () => {
    const info = domainFromEvent(
      fakeElement({ 'data-domain-id': 'HC1:0' }) as unknown as EventTarget,
      construct,
    );
    expect(info?.domain.type).toBe('VH');
    expect(info?.chain?.id).toBe('HC1');
  });

  it('walks up to the owning domain group', () => {
    const info = domainFromEvent(
      fakeElement({ fill: 'red' }, [{ 'data-domain-id': 'HC2:4' }]) as unknown as EventTarget,
      construct,
    );
    expect(info?.domain.type).toBe('CH3');
  });

  it('returns null away from any domain', () => {
    expect(domainFromEvent(null, construct)).toBeNull();
    expect(domainFromEvent(fakeElement({}) as unknown as EventTarget, construct)).toBeNull();
  });

  it('resolves a modification marker with its catalog label', () => {
    const info = modificationFromEvent(
      fakeElement({
        'data-modification-type': 'knob',
        'data-domain-id': 'HC1:4',
      }) as unknown as EventTarget,
      construct,
    );
    expect(info?.modification.label).toBe('knob (T366W)');
    expect(info?.modification.residues).toEqual(['T366W']);
    expect(info?.domain?.type).toBe('CH3');
  });
});
