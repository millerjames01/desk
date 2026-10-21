/** Site profiles: the shipped defaults, with your edits (Read → Journals) on top. */

import { kvGet, kvSet } from '../db';
import { DEFAULT_PROFILES, type SiteProfile } from './sites';

export async function loadProfiles(): Promise<SiteProfile[]> {
  const mine = (await kvGet<SiteProfile[]>('profiles')) ?? [];
  const byDomain = new Map(DEFAULT_PROFILES.map((p) => [p.domain, p]));
  for (const p of mine) byDomain.set(p.domain, p);
  return [...byDomain.values()];
}

/** Saves only the profiles that differ from the defaults. */
export async function saveProfiles(list: SiteProfile[]): Promise<void> {
  const defaults = new Map(DEFAULT_PROFILES.map((p) => [p.domain, JSON.stringify(p)]));
  await kvSet('profiles', list.filter((p) => defaults.get(p.domain) !== JSON.stringify(p)));
}
