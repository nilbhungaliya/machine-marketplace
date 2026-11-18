import { describe, expect, it } from 'vitest';
import { toCsv } from './csv.js';

const BOM = '﻿';

describe('toCsv', () => {
  it('quotes fields with commas or quotes, doubles quotes, empties null, joins with CRLF after a BOM', () => {
    expect(toCsv([['a', 'b,c'], ['say "hi"', null]])).toBe('﻿a,"b,c"\r\n"say ""hi""",');
  });

  it('quotes fields with newlines and stringifies numbers and booleans', () => {
    expect(toCsv([['line1\nline2', 'cr\rhere', 12.5, true, false]])).toBe('﻿"line1\nline2","cr\rhere",12.5,true,false');
  });

  it("prefixes text starting with = + - @ TAB or CR with ' so spreadsheets do not run it as a formula", () => {
    expect(toCsv([['=SUM(A1)', '+1', '-2', '@cmd', '\tx', '\rx', 'a=b']])).toBe(
      `${BOM}'=SUM(A1),'+1,'-2,'@cmd,'\tx,"'\rx",a=b`,
    );
  });

  it('prefixes before quoting when the cell also needs quotes', () => {
    expect(toCsv([['=HYPERLINK("x","y")']])).toBe(`${BOM}"'=HYPERLINK(""x"",""y"")"`);
  });

  it('leaves numbers and booleans alone, even negative numbers', () => {
    expect(toCsv([[-5, 0.5, true]])).toBe(`${BOM}-5,0.5,true`);
  });

  it('returns just the BOM for no rows', () => {
    expect(toCsv([])).toBe('﻿');
  });
});
