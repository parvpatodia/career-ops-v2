/**
 * Human-readable label for a hot-list entry's raw `platform` token, so the UI
 * shows "SWE List email" / "Greenhouse" instead of "email:swelist" / "greenhouse".
 * Pure + shared so the label is defined once and unit-tested.
 */

// Known aggregator/board tokens -> friendly names.
const BOARD_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  workday: 'Workday',
  newgrad: 'New Grad list',
  swelist: 'SWE List',
};

// Known email senders (the slug after "email:") -> friendly names.
const EMAIL_SENDERS: Record<string, string> = {
  linkedin: 'LinkedIn',
  swelist: 'SWE List',
  scalar: 'Scalar',
  jobright: 'Jobright',
  jobrighteric: 'Jobright',
  indeed: 'Indeed',
  handshake: 'Handshake',
  wellfound: 'Wellfound',
};

const titleCase = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function sourceLabel(platform: string | undefined | null): string {
  const p = (platform ?? '').trim();
  if (!p) return 'Unknown source';
  if (p.toLowerCase().startsWith('email:')) {
    const slug = p.slice(p.indexOf(':') + 1).toLowerCase();
    return `${EMAIL_SENDERS[slug] ?? titleCase(slug)} email`;
  }
  return BOARD_LABELS[p.toLowerCase()] ?? titleCase(p);
}
