export type TokenKind =
  | 'name'
  | 'number'
  | 'dash'
  | 'tilde'
  | 'star'
  | 'group' // parenthesised specificity, value is the raw inner text
  | 'mods' // bracketed modification list, value is the raw inner text
  | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

export class DslError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly pos: number,
  ) {
    super(`line ${line}, col ${pos + 1}: ${message}`);
    this.name = 'DslError';
  }
}

const NAME_START = /[A-Za-z_?]/;
const NAME_CHAR = /[A-Za-z0-9_.']/;

/**
 * Tokenize one chain expression. Parenthesised and bracketed groups are scanned
 * raw so that specificity names ("PD-L1") and modification names ("lala-pg")
 * can contain characters that are operators at the top level.
 */
export function tokenize(src: string, lineNo = 1): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '-') {
      tokens.push({ kind: 'dash', value: '-', pos: i });
      i++;
    } else if (ch === '~') {
      tokens.push({ kind: 'tilde', value: '~', pos: i });
      i++;
    } else if (ch === '*') {
      tokens.push({ kind: 'star', value: '*', pos: i });
      i++;
    } else if (ch === '(' || ch === '[') {
      const close = ch === '(' ? ')' : ']';
      const end = src.indexOf(close, i + 1);
      if (end < 0) throw new DslError(`unterminated "${ch}"`, lineNo, i);
      tokens.push({
        kind: ch === '(' ? 'group' : 'mods',
        value: src.slice(i + 1, end).trim(),
        pos: i,
      });
      i = end + 1;
    } else if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j]!)) j++;
      tokens.push({ kind: 'number', value: src.slice(i, j), pos: i });
      i = j;
    } else if (NAME_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && NAME_CHAR.test(src[j]!)) j++;
      tokens.push({ kind: 'name', value: src.slice(i, j), pos: i });
      i = j;
    } else {
      throw new DslError(`unexpected character "${ch}"`, lineNo, i);
    }
  }
  tokens.push({ kind: 'eof', value: '', pos: src.length });
  return tokens;
}
