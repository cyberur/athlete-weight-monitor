/** Pure state machine for the on-screen numeric keypad. Input is a string like "72.4". */

export type KeyAction = { type: 'digit'; d: string } | { type: 'dot' } | { type: 'back' } | { type: 'clear' } | { type: 'set'; value: string };

export const MAX_INT_DIGITS = 3;
export const MAX_DECIMALS = 2;

export function keypadReduce(value: string, a: KeyAction): string {
  switch (a.type) {
    case 'clear':
      return '';
    case 'set':
      return a.value;
    case 'back':
      return value.slice(0, -1);
    case 'dot':
      if (value.includes('.')) return value; // prevent multiple separators
      return value === '' ? '0.' : value + '.';
    case 'digit': {
      if (!/^[0-9]$/.test(a.d)) return value;
      const [int, dec] = value.split('.');
      if (dec !== undefined) {
        if (dec.length >= MAX_DECIMALS) return value;
        return value + a.d;
      }
      if (int === '0') return a.d; // no leading zeros
      if (int.length >= MAX_INT_DIGITS) return value;
      return value + a.d;
    }
  }
}

/** Parse keypad text into kg, or null if incomplete/empty. */
export function parseKeypad(value: string): number | null {
  if (value === '' || value === '.' || value === '0.') return null;
  const n = Number(value.endsWith('.') ? value.slice(0, -1) : value);
  return Number.isFinite(n) ? n : null;
}

export function kgToKeypad(kg: number): string {
  const c = Math.round(kg * 100);
  return c % 10 === 0 ? (c / 100).toFixed(1) : (c / 100).toFixed(2);
}
