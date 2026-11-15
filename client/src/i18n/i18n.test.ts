import { describe, expect, it } from 'vitest';
import { LANGS } from './index';

type Tree = { [k: string]: string | string[] | Tree };

function leaves(o: Tree, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, leaves(v as Tree, key));
    else out[key] = v;
  }
  return out;
}

describe('i18n dictionaries', () => {
  const az = leaves(LANGS.az.dict as unknown as Tree);
  const en = leaves(LANGS.en.dict as unknown as Tree);

  it('AZ and EN have exactly the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(az).sort());
  });

  it('no empty translations', () => {
    for (const [lang, d] of [['az', az], ['en', en]] as const) {
      for (const [k, v] of Object.entries(d)) {
        const ok = Array.isArray(v) ? v.length > 0 && v.every((x) => String(x).trim()) : String(v).trim().length > 0;
        expect(ok, `${lang}:${k}`).toBe(true);
      }
    }
  });

  it('covers the new mobility-impaired role and Priority #1 texts', () => {
    expect(az['admin.roles.mobility_impaired']).toBeTruthy();
    expect(en['dispatch.alertPriority']).toContain('{zone}');
    expect(az['citizen.accessibleRoute']).toBeTruthy();
  });
});
