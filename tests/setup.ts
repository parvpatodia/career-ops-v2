/**
 * Global test setup. Runs once per test file before any test.
 *
 * WHY: side-effecting classes must never write into the real data/ tree under
 * test (LESSONS 2026-06-12: tests wrote fixture caches into real data/daily_log
 * for a month). The Logger appends an audit line on every emit; with fixtures
 * like TestCo/ReadyCo/AppliedCo flowing through ApplicationStore, that dirtied
 * the tracked daily_log on every `npm test`. Nothing reads the ops log back, so
 * disabling file logging for the whole suite is strictly safer than redirecting
 * to a temp dir (no temp litter, no race on the shared dir).
 */
process.env.CAREER_OPS_LOG_DISABLE = '1';
