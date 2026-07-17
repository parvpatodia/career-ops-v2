/**
 * Non-US location detection for the job feeds (Parv targets US Fall-2026 roles).
 * Shared so ingestion (emailJobs) and the UI read boundary (JobFeedService) agree.
 *
 * Conservative: only tokens that are unambiguously non-US. Deliberately EXCLUDES
 * ambiguous names that are also US places — e.g. "Ontario" (Ontario, CA is US),
 * "Waterloo" (Waterloo, IA), "QC" (quality control) — to avoid dropping US roles.
 */
export const NON_US =
  /(\bindia\b|bengaluru|bangalore|hyderabad|\bpune\b|gurgaon|noida|\blondon\b|\buk\b|united kingdom|\bengland\b|\bscotland\b|\bcanada\b|toronto|vancouver|montr[eé]al|\bquebec\b|ottawa|calgary|edmonton|mississauga|winnipeg|singapore|dublin|ireland|berlin|munich|germany|\bparis\b|\bfrance\b|amsterdam|netherlands|z[uü]rich|switzerland|stockholm|sweden|copenhagen|denmark|tokyo|\bjapan\b|\bseoul\b|\bkorea\b|shanghai|beijing|shenzhen|\bchina\b|hong kong|bangkok|thailand|jakarta|manila|kuala lumpur|sydney|melbourne|australia|auckland|tel aviv|israel|s[ãa]o paulo|\bbrazil\b|\bmexico\b|\bpoland\b|warsaw|\bspain\b|madrid|barcelona|portugal|lisbon|bucharest|romania|\buae\b|dubai|abu dhabi|nigeria|lagos|nairobi|\begypt\b|cairo)/i;

export function isLikelyNonUS(text: string): boolean {
  return NON_US.test(text ?? '');
}
