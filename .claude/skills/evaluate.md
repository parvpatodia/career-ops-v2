---
name: evaluate
description: Score job-resume fit using the weighted formula. Returns score/100, breakdown, and recommendation.
user_invocable: true
args: job_id_or_command
---

# evaluate — Job-Resume Fit Scoring

## Args
- `[job_id]` → score a single job
- `top [N]` → score N jobs sorted by recency, return ranked list
- `batch` → score all unscored jobs from today's scan

## Scoring Algorithm

```
score = (
  skill_match    * 0.30 +
  experience     * 0.20 +
  location       * 0.15 +
  visa           * 0.15 +
  company_signal * 0.10 +
  timing         * 0.10
) * 100
```

Weights and thresholds come from `config/scoring.yml`.

## Hard Rules
- score < 50 → `shouldApply: false`, status = SKIP
- score < 60 → skip cover letter generation
- visa = `requires_permanent` → score = 0, blocked

## Execution

### Single job
```
Read job from today's scan cache or data/applications.json
npm run eval -- --job [job_id]
```

### Output format per job:
```
[001] Acme Corp — ML Engineer Intern
Score: 82/100 ✅ APPLY

Breakdown:
  Skills:     90/100  (PyTorch ✓, Computer Vision ✓, CUDA ✓)
  Experience: 85/100  (intern level, 0-2yr requirement)
  Location:   100/100 (San Francisco Bay Area)
  Visa:       100/100 (explicitly sponsors F-1)
  Company:    70/100  (Series B startup, AI-native)
  Timing:     95/100  (posted 3h ago)

Missing skills: CUDA, MLflow
Recommended variant: ml.md
Cover letter: YES (score ≥ 60)

Reasoning: Strong overall fit. Skill match is strong. Explicitly sponsors F-1/OPT.
```

### Batch output:
Ranked table sorted by score descending. Mark top 10 with ✅, rest with ⚠️ or ❌.

## After Evaluation
- Write result to `data/applications.json` via `npm run track`
- Ask: "Want me to tailor and generate PDFs for the top N jobs?"
