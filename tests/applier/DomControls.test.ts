/**
 * DomControls is the shared fill/read primitive every portal FormSource uses,
 * so its ROUTING (which Playwright primitive runs per field type) is core
 * verify-or-abstain behavior. Tested with fake Locator/Page that record calls,
 * so the routing + the checkbox affirmative logic + the native-vs-custom select
 * branch are verified with no browser. The real DOM behavior is demo-proven.
 */

import { describe, it, expect } from 'vitest';
import type { Locator, Page } from 'playwright';
import { fillControl, readControl, confidentOptionIndex, normalizeReactOption } from '../../src/applier/DomControls.js';
import type { FieldIntent, FormField } from '../../src/applier/IntentPayload.js';

type Call = [string, ...unknown[]];

interface FakeOpts {
  evaluateReturn?: unknown; // tagName (fill) or selected text (read)
  isChecked?: boolean;
  inputValue?: string;
  optionCount?: number; // how many react-select options the locator "matches"
  optionTexts?: string[]; // react-select menu option labels (for confident-match)
}

class FakeLocator {
  calls: Call[] = [];
  constructor(private readonly opts: FakeOpts = {}) {}
  async scrollIntoViewIfNeeded(): Promise<void> { this.calls.push(['scrollIntoViewIfNeeded']); }
  async setInputFiles(v: string): Promise<void> { this.calls.push(['setInputFiles', v]); }
  async setChecked(v: boolean): Promise<void> { this.calls.push(['setChecked', v]); }
  async click(): Promise<void> { this.calls.push(['click']); }
  async selectText(): Promise<void> { this.calls.push(['selectText']); }
  async pressSequentially(v: string): Promise<void> { this.calls.push(['pressSequentially', v]); }
  async selectOption(o: unknown): Promise<void> { this.calls.push(['selectOption', o]); }
  async isChecked(): Promise<boolean> { return this.opts.isChecked ?? false; }
  async inputValue(): Promise<string> { return this.opts.inputValue ?? ''; }
  async evaluate(): Promise<unknown> { return this.opts.evaluateReturn; }
  async count(): Promise<number> { return this.opts.optionCount ?? 0; }
  async allInnerTexts(): Promise<string[]> { return this.opts.optionTexts ?? []; }
  async waitFor(): Promise<void> { /* options already "rendered" in the fake */ }
  nth(i: number): this { this.calls.push(['nth', i]); return this; }
  filter(): this { return this; }
  first(): this { return this; }
  // react-select fill resolves the .select__control via locator(xpath); return
  // self so control.click() records on this same fake.
  locator(): this { return this; }
  has(name: string): boolean { return this.calls.some((c) => c[0] === name); }
  arg(name: string): unknown { return this.calls.find((c) => c[0] === name)?.[1]; }
}

class FakePage {
  keyPresses: string[] = [];
  // optionCount 1 => the matching .select__option is found and clicked.
  optionLocator = new FakeLocator({ optionCount: 1 });
  keyboard = { press: async (k: string): Promise<void> => { this.keyPresses.push(k); } };
  locator(): FakeLocator { return this.optionLocator; }
}

function intent(type: FormField['type'], value: string): FieldIntent {
  return { field: { id: 'f', label: 'F', type, required: true }, value, source: 'answer-source', confidence: 'high' };
}

const L = (l: FakeLocator): Locator => l as unknown as Locator;
const P = (p: FakePage): Page => p as unknown as Page;

describe('fillControl routing', () => {
  it('file -> setInputFiles with the path', async () => {
    const loc = new FakeLocator();
    await fillControl(P(new FakePage()), L(loc), intent('file', '/tmp/resume.pdf'));
    expect(loc.arg('setInputFiles')).toBe('/tmp/resume.pdf');
  });

  it('checkbox -> setChecked(true) for an affirmative value', async () => {
    const yes = new FakeLocator();
    await fillControl(P(new FakePage()), L(yes), intent('checkbox', 'Yes'));
    expect(yes.arg('setChecked')).toBe(true);

    const no = new FakeLocator();
    await fillControl(P(new FakePage()), L(no), intent('checkbox', 'No'));
    expect(no.arg('setChecked')).toBe(false);
  });

  it('text -> clears then types the value via pressSequentially (React-safe)', async () => {
    const loc = new FakeLocator();
    const page = new FakePage();
    await fillControl(P(page), L(loc), intent('text', 'Ada'));
    expect(loc.arg('pressSequentially')).toBe('Ada');
    expect(page.keyPresses).toContain('Delete'); // cleared before typing
    expect(loc.has('setInputFiles')).toBe(false);
  });

  it('native <select> -> selectOption by label', async () => {
    const loc = new FakeLocator({ evaluateReturn: 'native' });
    await fillControl(P(new FakePage()), L(loc), intent('select', 'Yes'));
    expect(loc.arg('selectOption')).toEqual({ label: 'Yes' });
  });

  it('react-select -> opens the control, types, waits, and CLICKS the confident option', async () => {
    const loc = new FakeLocator({ evaluateReturn: 'react-select' });
    const page = new FakePage();
    page.optionLocator = new FakeLocator({ optionTexts: ['Yes', 'No'] });
    await fillControl(P(page), L(loc), intent('select', 'Yes'));
    expect(loc.has('click')).toBe(true);                    // opened the .select__control
    expect(loc.arg('pressSequentially')).toBe('Yes');       // typed to filter
    expect(page.optionLocator.arg('nth')).toBe(0);          // selected the exact "Yes" (index 0)
    expect(page.optionLocator.has('click')).toBe(true);     // clicked it
    expect(page.keyPresses).not.toContain('Escape');        // confident match -> no abstain
  });

  it('react-select strips a trailing dial code so "United States" matches "United States+1"', async () => {
    const loc = new FakeLocator({ evaluateReturn: 'react-select' });
    const page = new FakePage();
    page.optionLocator = new FakeLocator({ optionTexts: ['United States+1', 'United States Minor Outlying Islands+1'] });
    await fillControl(P(page), L(loc), intent('select', 'United States'));
    expect(page.optionLocator.arg('nth')).toBe(0);          // exact "united states", not the longer entry
    expect(page.optionLocator.has('click')).toBe(true);
  });

  it('react-select with an AMBIGUOUS value -> abstains (Escape), never guesses', async () => {
    const loc = new FakeLocator({ evaluateReturn: 'react-select' });
    const page = new FakePage();
    page.optionLocator = new FakeLocator({ optionTexts: ['San Jose, Antique, Philippines', 'San Jose, CA, USA'] });
    await fillControl(P(page), L(loc), intent('select', 'San Jose'));
    expect(page.optionLocator.has('click')).toBe(false);    // did NOT pick a wrong city
    expect(page.keyPresses).toContain('Escape');            // closed the menu, left unset
  });

  it('legacy custom listbox -> opens then clicks the matching [role=option]', async () => {
    const loc = new FakeLocator({ evaluateReturn: 'custom' });
    const page = new FakePage();
    await fillControl(P(page), L(loc), intent('select', 'Yes'));
    expect(loc.has('click')).toBe(true);
    expect(page.optionLocator.has('click')).toBe(true);
    expect(loc.has('selectOption')).toBe(false);
  });
});

describe('readControl', () => {
  it('checkbox -> Yes/No from checked state', async () => {
    expect(await readControl(L(new FakeLocator({ isChecked: true })), { id: 'f', label: 'F', type: 'checkbox', required: true })).toBe('Yes');
    expect(await readControl(L(new FakeLocator({ isChecked: false })), { id: 'f', label: 'F', type: 'checkbox', required: true })).toBe('No');
  });

  it('text -> the input value, null when empty', async () => {
    expect(await readControl(L(new FakeLocator({ inputValue: 'Ada' })), { id: 'f', label: 'F', type: 'text', required: true })).toBe('Ada');
    expect(await readControl(L(new FakeLocator({ inputValue: '' })), { id: 'f', label: 'F', type: 'text', required: true })).toBeNull();
  });

  it('select -> the selected text (native or react-select single-value), null when empty', async () => {
    expect(await readControl(L(new FakeLocator({ evaluateReturn: 'Yes' })), { id: 'f', label: 'F', type: 'select', required: true })).toBe('Yes');
    expect(await readControl(L(new FakeLocator({ evaluateReturn: '' })), { id: 'f', label: 'F', type: 'select', required: true })).toBeNull();
  });

  it('file -> the attached file name (inputValue throws on file inputs), null when none', async () => {
    expect(await readControl(L(new FakeLocator({ evaluateReturn: 'resume.pdf' })), { id: 'f', label: 'F', type: 'file', required: true })).toBe('resume.pdf');
    expect(await readControl(L(new FakeLocator({ evaluateReturn: '' })), { id: 'f', label: 'F', type: 'file', required: true })).toBeNull();
  });
});

describe('normalizeReactOption', () => {
  it('strips a trailing phone dial code and normalizes case/space', () => {
    expect(normalizeReactOption('United States+1')).toBe('united states');
    expect(normalizeReactOption('  Åland Islands+358 ')).toBe('åland islands');
    expect(normalizeReactOption('Yes')).toBe('yes');
  });
});

describe('confidentOptionIndex (the react-select selection safety rule)', () => {
  it('returns an exact normalized match, dial code ignored', () => {
    expect(confidentOptionIndex(['Canada+1', 'United States+1', 'United Kingdom+44'], 'United States')).toBe(1);
  });

  it('prefers the exact match over a longer prefix sibling', () => {
    expect(confidentOptionIndex(['United States Minor Outlying Islands+1', 'United States+1'], 'United States')).toBe(1);
  });

  it('accepts a UNIQUE prefix match', () => {
    expect(confidentOptionIndex(['Massachusetts', 'Maryland', 'Maine'], 'Massach')).toBe(0);
  });

  it('ABSTAINS (-1) when the prefix is ambiguous — never guesses a city', () => {
    expect(confidentOptionIndex(['San Jose, Antique, Philippines', 'San Jose, CA, USA', 'San Jose del Cabo'], 'San Jose')).toBe(-1);
  });

  it('returns -1 when nothing matches, or the value is empty', () => {
    expect(confidentOptionIndex(['Yes', 'No'], 'Maybe')).toBe(-1);
    expect(confidentOptionIndex(['Yes', 'No'], '   ')).toBe(-1);
    expect(confidentOptionIndex([], 'Yes')).toBe(-1);
  });
});
