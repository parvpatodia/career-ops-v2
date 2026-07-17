/**
 * Company-name quality checks, shared so ingestion, the UI read boundary, and
 * the outreach bridge all agree on what counts as a real company. Email digest
 * parsers sometimes mis-capture a posting attribute (a season/term label, a bare
 * year, or a "(via ...)" placeholder) into the company field; none of those is a
 * company you can search for or show to a user.
 */

/** A term/season label ("Fall 2026", "Summer 2026", a bare year) mis-captured
 *  into the company field — never a real company. */
const TERM_LABEL = /^(fall|spring|summer|winter|autumn)?\s*20\d\d$|^(fall|spring|summer|winter|autumn)\s+20\d\d$/i;

/** True when `company` is a usable company name (not blank, not a "(via ...)"
 *  placeholder the email parser emits, not a term/season label). */
export function isRealCompany(company: string | undefined | null): boolean {
  const c = (company ?? '').trim();
  return c.length > 0 && !/^\(via\b/i.test(c) && !TERM_LABEL.test(c);
}

/** The company name if usable, else '' — so a read boundary can show the role
 *  without a KNOWN-WRONG company label (honest blank beats a wrong name). */
export function cleanCompanyName(company: string | undefined | null): string {
  return isRealCompany(company) ? (company ?? '').trim() : '';
}
