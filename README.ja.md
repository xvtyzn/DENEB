# DENEB

[![CI](https://github.com/xvtyzn/DENEB/actions/workflows/ci.yml/badge.svg)](https://github.com/xvtyzn/DENEB/actions/workflows/ci.yml)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm%20Noncommercial%201.0.0-2f6f5e)](LICENSE)
![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=nodedotjs&logoColor=white)
![TypeScript 5.7+](https://img.shields.io/badge/TypeScript-5.7%2B-3178C6?logo=typescript&logoColor=white)
![Core gzip: 31 kB](https://img.shields.io/badge/core_gzip-31_kB-555555)

**D**rawing **E**ngine for **N**otated, **E**ngineered **B**iologics

[English](README.md) · [詳細リファレンス](docs/reference.ja.md)

DENEB は、宣言的に記述した抗体構造を埋め込み可能な SVG 模式図へ変換します。
通常の IgG、バイスペシフィック、フラグメント、Fc 融合、ADC、非 Ig 融合を扱い、
標的の色とエンジニアリング要素を一貫して表示します。

![6 種類の抗体フォーマットを同じパレットで描いたもの](docs/images/formats.png)

> DENEB はアノテーションを可視化するライブラリです。配列からアノテーション自体を
> 推定するものではないため、HMM・機械学習・既存パイプラインの出力を渡してください。

## 特徴

- コアはランタイム依存ゼロで、ブラウザ、Node、SSR、静的書き出しに対応。
- React 版も同じ Scene を実際の SVG 要素として描画し、ドメインのイベントを保持。
- 模式図、linear アーキテクチャ、凡例のみの 3 ビュー。
- バイスペシフィック、フラグメント、Fc 融合、ADC など 49 種のプリセット。
- lint、diff、複数分子パネル、配列 import、AbML、VERITAS は独立したサブパス。

## インストール

```sh
npm install deneb
```

`react` と `react-dom` は任意の peer dependency で、`deneb/react` を使う場合だけ
必要です。

## 最小例

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

React では次のように使います。

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

同梱フォーマットを使う場合は、プリセットを明示的に解決します。プリセットを使わない
アプリケーションにカタログ全体を読み込ませないためです。

```ts
import { renderSVG } from 'deneb';
import { getPreset } from 'deneb/presets';

const { svg } = renderSVG(getPreset('igg-kih'));
```

## 入力とビュー

正式な入力は構造化された `Construct` です。テストデータや手書きの設計にはコンパクトな
DSL も利用できます。

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

| ビュー | 関数 | React コンポーネント | 用途 |
| --- | --- | --- | --- |
| 模式図 | `renderSVG` | `<AntibodyViewer>` | フォーマットと対合関係の把握 |
| Linear | `renderLinear` | `<AntibodyLinear>` | ドメイン順序と残基位置 |
| 凡例 | `renderLegend` | `<AntibodyLegend>` | 図版で共用する凡例 |

各ドメインは `data-domain-*` 属性を持ち、ドメイン、鎖、特異性、改変を指定して
強調できます。コンジュゲートには組み込みグリフまたは信頼済みの化学構造式を使用
できます。`payload.structure.svg` はサニタイズせず埋め込まれるため、ユーザ入力由来の
構造式には `href` を使用してください。

## 任意のサブパス

| import | 内容 |
| --- | --- |
| `deneb/react` | React ビューアと配列ビュー |
| `deneb/presets` | 同梱 construct カタログ |
| `deneb/lint` | 指摘箇所を強調できる設計チェック |
| `deneb/diff` | 親と変異体の比較 |
| `deneb/panel` | 複数分子の図版 |
| `deneb/import` | ANARCI / IgBLAST アダプタ |
| `deneb/abml` | AbML v1.06 の読み書き |
| `deneb/veritas` | VERITAS 名の読み書き |
| `deneb/chem` | 化合物の作図。抗体を向くように回転させる |

コアは gzip 約 31 kB で、ビューアだけを使うアプリケーションへ任意機能を取り込まない
ことを継続的に検査しています。

## 試す

このリポジトリを clone した環境で実行します。

```sh
npm install
npm run playground
```

[`examples/playground.html`](examples/playground.html) がサーバ経由で開き、DSL / AbML、
設計チェック、模式図、linear ビューが連動します。`npm run gallery` では全プリセットの
スタンドアロンギャラリーを生成できます。

## ドキュメント

[詳細リファレンス](docs/reference.ja.md)では、自動推定、レイアウト、改変、ADC の
構造式、インタラクション、設計チェック、比較パネル、配列 import、AbML、VERITAS、
API、プリセット、開発コマンドを説明しています。

英語の完全版は [`docs/reference.md`](docs/reference.md) にあります。

## ライセンス

[PolyForm Noncommercial 1.0.0](LICENSE)。研究・教育・個人利用、および条件を満たす
非営利組織による利用が対象です。商用利用には別途ライセンスが必要です。これは
source-available ライセンスであり、OSI 承認のオープンソースライセンスではありません。

同梱している定常領域配列は UniProt（CC BY 4.0）由来で、アクセッションは
`src/import/constant-regions.ts` に記録しています。
