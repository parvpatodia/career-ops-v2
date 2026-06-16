/**
 * `npm run audit:answers` — runs a battery of common ATS questions through the
 * REAL answer stack (AnswerKB + AnswerGenerator over config/profile.yml) and the
 * REAL IntentPayloadBuilder gate, then reports exactly which questions ANSWER vs
 * ABSTAIN. The abstains are the gaps Parv must fill in config/answers.yml.
 *
 * This is the offline "what can't we answer yet" check; truly form-specific
 * unknowns still surface at apply time via the AnswerInbox. No PII is printed
 * beyond the answer values Parv already authored (his own machine).
 */

import 'dotenv/config';
import { ProfileLoader } from '../src/applier/ProfileLoader.js';
import { AnswerGenerator } from '../src/applier/AnswerGenerator.js';
import { AnswerKB, CompositeAnswerSource } from '../src/applier/AnswerKB.js';
import { EssayAnswerSource } from '../src/applier/EssayAnswerSource.js';
import { IntentPayloadBuilder } from '../src/applier/IntentPayload.js';
import type { FormField } from '../src/applier/IntentPayload.js';
import type { AnswerContext } from '../src/applier/AnswerGenerator.js';

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const f = (label: string, type: FormField['type'] = 'text'): FormField => ({
  id: label, label, type, required: true,
});

// A representative battery of real ATS questions across categories.
const QUESTIONS: FormField[] = [
  // identity
  f('First Name'), f('Last Name'), f('Email'), f('Phone'), f('Street Address'),
  f('City'), f('State'), f('Zip Code'), f('LinkedIn Profile'), f('GitHub URL'), f('Personal Website'),
  // education
  f('University'), f('Degree'), f('Field of Study'), f('GPA'), f('Expected Graduation Date'),
  // work authorization
  f('Are you authorized to work in the United States?'),
  f('Will you now or in the future require sponsorship?'),
  f('Country of Citizenship'), f('Are you a US Citizen?'),
  // EEO / legal
  f('What is your gender?'), f('Race / Ethnicity'), f('Are you Hispanic or Latino?'),
  f('Protected Veteran Status'), f('Disability Status'),
  // attestation
  f('I certify that the information provided is true and complete'),
  f('Do you agree to the terms and conditions?'),
  // consent
  f('Do you consent to a background check?'), f('Are you willing to take a drug test?'),
  // logistics
  f('Earliest start date'), f('Internship end date'), f('Are you willing to relocate?'),
  f('Preferred work location'), f('Desired hourly compensation'),
  // sourcing / misc
  f('How did you hear about us?'), f('Are you at least 18 years old?'),
  f('Have you previously applied here?'), f('Years of relevant experience'),
  f('Preferred Name'), f('Pronouns'),
  // narrative
  f('Tell us about yourself', 'textarea'),
  f('Why do you want to work at Acme Robotics?', 'textarea'),
  f('Why are you interested in this role?', 'textarea'),
  f('What is your greatest achievement?', 'textarea'),
];

function main(): void {
  const profile = new ProfileLoader();
  const answers = new CompositeAnswerSource([
    new AnswerKB(),
    new EssayAnswerSource(profile),
    new AnswerGenerator(profile),
  ]);
  const builder = new IntentPayloadBuilder(answers);
  const ctx: AnswerContext = { company: 'Acme Robotics', role: 'Machine Learning Engineer Intern' };

  const result = builder.build(QUESTIONS, ctx);
  const abstainById = new Map(result.reasons.map((r) => [r.fieldId, r.why]));
  const intentById = new Map(result.intents.map((i) => [i.field.id, i.value]));

  console.log(C.bold('\n  ANSWER AUDIT — what auto-fills vs what needs your input\n'));
  const gaps: Array<{ q: string; why: string }> = [];

  for (const q of QUESTIONS) {
    if (intentById.has(q.id)) {
      const v = String(intentById.get(q.id)).replace(/\s+/g, ' ');
      console.log(`  ${C.green('✓ ANSWER ')} ${q.label}`);
      console.log(`             ${C.dim('→ ' + (v.length > 90 ? v.slice(0, 90) + '…' : v))}`);
    } else {
      const why = abstainById.get(q.id) ?? 'skipped (optional, no answer)';
      gaps.push({ q: q.label, why });
      console.log(`  ${C.red('✗ GAP    ')} ${q.label}`);
      console.log(`             ${C.yellow('→ ' + why)}`);
    }
  }

  console.log(C.bold(`\n  ${result.intents.length}/${QUESTIONS.length} auto-answered, ${gaps.length} gap(s).`));
  if (gaps.length > 0) {
    console.log(C.bold('\n  QUESTIONS THAT NEED YOUR INPUT:'));
    for (const g of gaps) console.log(`    • ${g.q}`);
    console.log(C.dim('\n  Add each to config/answers.yml as { match: [...], value: "..." } (human-approved).'));
  }
}

main();
