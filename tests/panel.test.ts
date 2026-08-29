import { describe, expect, it } from 'vitest';
import { parseDSL } from '../src/index';
import type { SceneNode } from '../src/render/scene-types';
import { renderComparison, renderPanel } from '../src/render/panel';
import { getPreset } from '../src/presets/index';

/** Every node in a scene, flattened. */
function walk(nodes: SceneNode[]): SceneNode[] {
  return nodes.flatMap((n) => (n.kind === 'group' ? [n, ...walk(n.children)] : [n]));
}

/** The fill each target was drawn in, per cell. */
function fillsBySpecificity(nodes: SceneNode[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const node of walk(nodes)) {
    const spec = node.data?.['specificity'];
    if (!spec || node.kind !== 'group') continue;
    // The domain's own outline is the first painted child.
    const outline = node.children.find((c) => c.fill && c.fill !== 'none');
    if (!outline?.fill) continue;
    if (!out.has(spec)) out.set(spec, new Set());
    out.get(spec)!.add(outline.fill);
  }
  return out;
}

describe('renderPanel', () => {
  // The same two targets, met in the opposite order.
  const first = parseDSL('HC: VH(CD3)-CH1-h-CH2-CH3\nLC: VL(CD3)-CL');
  const second = parseDSL('HC: VH(HER2)-CH1-h-CH2-CH3\nLC: VL(HER2)-CL');
  const both = parseDSL(`
    HC1: VH(HER2)-CH1-h-CH2-CH3[knob]
    LC1: VL(HER2)-CL
    HC2: VH(CD3)-CH1-h-CH2-CH3[hole]
    LC2: VL(CD3)-CL
  `);

  it('gives a target one colour across the whole figure', () => {
    const { scene } = renderPanel([{ construct: first }, { construct: second }, { construct: both }]);
    const fills = fillsBySpecificity(scene.children);
    // Each target is drawn in exactly two shades: the heavy one and its tint.
    for (const [spec, colours] of fills) {
      expect(colours.size, `${spec} was drawn in ${[...colours].join(', ')}`).toBeLessThanOrEqual(2);
    }
    expect([...fills.keys()].sort()).toEqual(['CD3', 'HER2']);
  });

  it('would not do so if each cell were rendered on its own', () => {
    // Guards the value of the rule above: rendered separately, the two
    // constructs each number their targets from scratch.
    const alone = renderPanel([{ construct: first }]).scene;
    const other = renderPanel([{ construct: second }]).scene;
    const a = [...fillsBySpecificity(alone.children).get('CD3')!][0];
    const b = [...fillsBySpecificity(other.children).get('HER2')!][0];
    expect(a).toBe(b);
  });

  it('draws one legend for the figure, not one per cell', () => {
    const { svg } = renderPanel([{ construct: first }, { construct: both }]);
    expect((svg.match(/class="dn-legend"/g) ?? []).length).toBe(1);
    expect((svg.match(/class="dn-legend-swatch"/g) ?? []).length).toBe(2);
  });

  it('can be told not to draw a legend at all', () => {
    const { svg } = renderPanel([{ construct: first }], { sharedLegend: false });
    expect(svg).not.toContain('dn-legend');
  });

  it('keeps every cell at the same scale by default', () => {
    const { scene } = renderPanel([
      { construct: getPreset('scfv') },
      { construct: getPreset('igg-kih') },
    ]);
    const cells = walk(scene.children).filter((n) => n.className === 'dn-panel-cell');
    expect(cells).toHaveLength(2);
    for (const cell of cells) expect(cell.transform).toContain('scale(1)');
  });

  it('scales cells to fit when asked', () => {
    const { scene } = renderPanel(
      [{ construct: getPreset('scfv') }, { construct: getPreset('igg-kih') }],
      { uniformScale: false },
    );
    const scales = walk(scene.children)
      .filter((n) => n.className === 'dn-panel-cell')
      .map((n) => Number(/scale\(([\d.]+)\)/.exec(n.transform ?? '')?.[1]));
    expect(Math.max(...scales)).toBeGreaterThan(Math.min(...scales));
  });

  it('lays cells out in a grid and captions them', () => {
    const { svg } = renderPanel(
      [1, 2, 3, 4, 5].map((n) => ({ construct: first, label: `variant ${n}` })),
      { columns: 2, title: 'Panel' },
    );
    expect((svg.match(/class="dn-panel-cell"/g) ?? []).length).toBe(5);
    expect(svg).toContain('variant 5');
    expect(svg).toContain('>Panel<');
  });
});

describe('renderComparison', () => {
  it('puts the parent and the variant side by side with the changes lit up', () => {
    const parent = getPreset('igg-kih');
    const variant = parseDSL(`
      HC1: VH(CD3)-CH1-h-CH2[lala]-CH3[knob]
      LC1: VL(CD3)-CL
      HC2: VH(HER2)-CH1-h-CH2[lala]-CH3[hole]
      LC2: VL(HER2)-CL
    `);
    const { svg, changes } = renderComparison(parent, variant, {
      labels: ['parent', 'Fc-silenced'],
    });
    expect(changes.map((c) => c.kind)).toEqual([
      'modification-added',
      'modification-added',
    ]);
    expect(svg).toContain('parent');
    expect(svg).toContain('Fc-silenced');
    // Only the variant's CH2 domains are ringed.
    expect((svg.match(/class="dn-highlight"/g) ?? []).length).toBe(2);
  });
});
