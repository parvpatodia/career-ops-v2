/**
 * DomControls is the shared fill/read primitive every portal FormSource uses,
 * so its ROUTING (which Playwright primitive runs per field type) is core
 * verify-or-abstain behavior. Tested with fake Locator/Page that record calls,
 * so the routing + the checkbox affirmative logic + the native-vs-custom select
 * branch are verified with no browser. The real DOM behavior is demo-proven.
 */

import { describe, it, expect } from 'vitest';
import type { Locator, Page } from 'playwright';
import { fillControl, readControl } from '../../src/applier/DomControls.js';
import type { FieldIntent, FormField } from '../../src/applier/IntentPayload.js';

type Call = [string, ...unknown[]];

interface FakeOpts {
  evaluateReturn?: unknown; // tagName (fill) or selected text (read)
  isChecked?: boolean;
  inputValue?: string;
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
  filter(): this { return this; }
  first(): this { return this; }
  has(name: string): boolean { return this.calls.some((c) => c[0] === name); }
  arg(name: string): unknown { return this.calls.find((c) => c[0] === name)?.[1]; }
}

class FakePage {
  keyPresses: string[] = [];
  optionLocator = new FakeLocator();
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
    const loc = new FakeLocator({ evaluateReturn: 'select' });
    await fillControl(P(new FakePage()), L(loc), intent('select', 'Yes'));
    expect(loc.arg('selectOption')).toEqual({ label: 'Yes' });
  });

  it('custom (react-select) -> opens the control and clicks the matching option', async () => {
    const loc = new FakeLocator({ evaluateReturn: 'div' }); // not a native <select>
    const page = new FakePage();
    await fillControl(P(page), L(loc), intent('select', 'Yes'));
    expect(loc.has('click')).toBe(true);            // opened the control
    expect(page.optionLocator.has('click')).toBe(true); // clicked the option in the listbox
    expect(loc.has('selectOption')).toBe(false);    // did NOT use the native path
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

  it('select -> the selected text, null when empty', async () => {
    expect(await readControl(L(new FakeLocator({ evaluateReturn: 'Yes' })), { id: 'f', label: 'F', type: 'select', required: true })).toBe('Yes');
    expect(await readControl(L(new FakeLocator({ evaluateReturn: '' })), { id: 'f', label: 'F', type: 'select', required: true })).toBeNull();
  });
});
