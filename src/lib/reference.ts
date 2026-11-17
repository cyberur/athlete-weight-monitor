import type { ReferenceData, WeightClassRef } from './types';

/**
 * Default IMMAF-style reference data. Stored locally and fully editable in Settings.
 *
 * Sources (checked Nov 2026):
 *  - Senior/Junior: IMMAF Weight Management Policy (immaf.org, 29 Jun 2024) "new" categories.
 *  - Youth A/B/C: IMMAF Youth World Championships FAQ (immaf.org, 5 May 2021).
 *  - Youth D (10–11): division confirmed in the 2026 IMMAF Youth MMA Rules Summary, but no
 *    official weight classes could be verified, so none are pre-filled. Add them in Settings.
 * Verify against the current IMMAF rulebook before competition use.
 */
const M = 'M' as const;
const F = 'F' as const;
const MF = 'MF' as const;

const kgClasses = (list: number[]): WeightClassRef[] => list.map((kg) => ({ kg, label: `-${kg} kg`, sex: MF }));

const seniorJunior: WeightClassRef[] = [
  { kg: 47.6, label: 'Atomweight', sex: F },
  { kg: 52.2, label: 'Strawweight', sex: MF },
  { kg: 56.7, label: 'Flyweight', sex: MF },
  { kg: 61.2, label: 'Bantamweight', sex: MF },
  { kg: 65.8, label: 'Featherweight', sex: MF },
  { kg: 70.3, label: 'Lightweight', sex: MF },
  { kg: 74.8, label: 'Super Lightweight', sex: MF },
  { kg: 79.4, label: 'Super Welterweight', sex: MF },
  { kg: 83.9, label: 'Middleweight', sex: M },
  { kg: 88.4, label: 'Super Middleweight', sex: M },
  { kg: 93.0, label: 'Light Heavyweight', sex: M },
  { kg: 97.0, label: 'Heavyweight', sex: M },
];

const youthA: WeightClassRef[] = [
  { kg: 47.7, label: 'Atomweight', sex: F },
  { kg: 52.2, label: 'Strawweight', sex: MF },
  { kg: 56.7, label: 'Flyweight', sex: MF },
  { kg: 61.2, label: 'Bantamweight', sex: MF },
  { kg: 65.8, label: 'Featherweight', sex: MF },
  { kg: 70.3, label: 'Lightweight', sex: MF },
  { kg: 77.1, label: 'Welterweight', sex: MF },
  { kg: 83.9, label: 'Middleweight', sex: M },
  { kg: 93.0, label: 'Light Heavyweight', sex: M },
  { kg: 120.2, label: 'Heavyweight', sex: M },
];

export const DEFAULT_REFERENCE: ReferenceData = {
  version: 1,
  source:
    'IMMAF Weight Management Policy (Jun 2024) for Senior/Junior; IMMAF Youth World Championships FAQ (May 2021) for Youth A–C. Youth D classes not verified. Open-ended (+) classes are omitted because they have no upper limit.',
  updatedAt: '2026-11-17T00:00:00.000Z',
  divisions: [
    { name: 'Senior', ages: '18+', classes: seniorJunior },
    { name: 'Junior', ages: '18–20', classes: seniorJunior },
    { name: 'Youth A', ages: '16–17', classes: youthA },
    { name: 'Youth B', ages: '14–15', classes: kgClasses([40, 44, 48, 52, 57, 62, 67, 72]) },
    { name: 'Youth C', ages: '12–13', classes: kgClasses([31, 34, 37, 40, 44, 48, 52, 57]) },
    {
      name: 'Youth D',
      ages: '10–11',
      classes: [],
      note: 'Official Youth D weight classes not verified — add them here or enter a custom limit per athlete.',
    },
  ],
};

export function classLabel(ref: ReferenceData, division: string, kg: number): string {
  const d = ref.divisions.find((x) => x.name.toLowerCase() === division.toLowerCase());
  const c = d?.classes.find((x) => Math.round(x.kg * 100) === Math.round(kg * 100));
  return c && !c.label.endsWith('kg') ? `${c.label} ${kg.toFixed(1)}` : `${kg.toFixed(1)} kg`;
}
