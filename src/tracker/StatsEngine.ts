/**
 * Computes pipeline analytics from the application store.
 * WHY: Keeping stats computation separate from storage lets us
 * test each independently and swap the store without breaking reporting.
 */

import type { Application, ApplicationStatus, Platform, ResumeVariant, Stats } from '../types.js';

export class StatsEngine {
  compute(applications: Application[], period: Stats['period']): Stats {
    const filtered = this.filterByPeriod(applications, period);

    return {
      period,
      totalApplications: filtered.length,
      byStatus: this.groupBy(filtered, (a) => a.status) as Record<ApplicationStatus, number>,
      byPlatform: {} as Record<Platform, number>, // populated by scanner data, not application records
      byResumeVariant: this.groupBy(filtered, (a) => a.resumeVariant) as Record<ResumeVariant, number>,
      conversionRate: this.computeConversion(filtered),
      averageScore: this.average(filtered.map((a) => a.score)),
      topCompanies: this.topN(filtered, (a) => a.company, 5),
    };
  }

  private filterByPeriod(applications: Application[], period: Stats['period']): Application[] {
    if (period === 'all') return applications;

    const now = Date.now();
    const cutoffs: Record<Exclude<Stats['period'], 'all'>, number> = {
      today: 24 * 60 * 60 * 1000,
      week: 7 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
    };
    const cutoff = now - cutoffs[period];
    return applications.filter((a) => new Date(a.date).getTime() >= cutoff);
  }

  private groupBy<T extends string>(
    items: Application[],
    key: (a: Application) => T
  ): Record<T, number> {
    return items.reduce(
      (acc, a) => {
        const k = key(a);
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      },
      {} as Record<T, number>
    );
  }

  private computeConversion(apps: Application[]): Stats['conversionRate'] {
    const applied = apps.filter((a) =>
      ['Applied', 'Responded', 'Interview', 'Offer', 'Rejected'].includes(a.status)
    ).length;
    const responded = apps.filter((a) =>
      ['Responded', 'Interview', 'Offer'].includes(a.status)
    ).length;
    const interviewed = apps.filter((a) =>
      ['Interview', 'Offer'].includes(a.status)
    ).length;
    const offered = apps.filter((a) => a.status === 'Offer').length;

    return {
      appliedToResponse: applied > 0 ? responded / applied : 0,
      responseToInterview: responded > 0 ? interviewed / responded : 0,
      interviewToOffer: interviewed > 0 ? offered / interviewed : 0,
    };
  }

  private average(nums: number[]): number {
    if (nums.length === 0) return 0;
    return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
  }

  private topN(
    apps: Application[],
    key: (a: Application) => string,
    n: number
  ): Array<{ company: string; count: number }> {
    const counts = apps.reduce(
      (acc, a) => {
        const k = key(a);
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, n)
      .map(([company, count]) => ({ company, count }));
  }

  /** Format stats as a human-readable summary string. */
  format(stats: Stats): string {
    const lines: string[] = [];
    lines.push(`=== Stats (${stats.period}) ===`);
    lines.push(`Total applications: ${stats.totalApplications}`);
    lines.push(`Average score: ${stats.averageScore}/100`);

    lines.push('\nBy status:');
    for (const [status, count] of Object.entries(stats.byStatus)) {
      lines.push(`  ${status}: ${count}`);
    }

    const cr = stats.conversionRate;
    lines.push('\nConversion rates:');
    lines.push(`  Applied → Response: ${(cr.appliedToResponse * 100).toFixed(1)}%`);
    lines.push(`  Response → Interview: ${(cr.responseToInterview * 100).toFixed(1)}%`);
    lines.push(`  Interview → Offer: ${(cr.interviewToOffer * 100).toFixed(1)}%`);

    if (stats.topCompanies.length > 0) {
      lines.push('\nTop companies:');
      for (const { company, count } of stats.topCompanies) {
        lines.push(`  ${company}: ${count}`);
      }
    }

    return lines.join('\n');
  }
}
