---
name: learn
description: Enforce learning from every session. Explain decisions, flag knowledge gaps, and generate end-of-session summaries.
user_invocable: true
args: command
---

# learn — Learning Enforcement

## Purpose
Every session should advance Parv's understanding, not just produce output.
This skill ensures every significant action comes with an explanation.

## Args
- `summary` → 3-sentence end-of-session summary
- `reconstruct [module]` → explain a module's architecture from memory (no file reading)
- `gaps` → identify what you should study based on today's activity

## Automatic Behaviors (always on)

### Code changes
When writing or modifying TypeScript:
- Every non-obvious design decision gets a `// WHY:` comment
- Example: `// WHY: Abstract base enforces caching across all scanner subclasses without duplication.`

### Resume tailoring
After each tailoring operation, explain:
```
Keyword injection log for [company] — [role]:

  "CUDA" → line 14 (Laksh.ai bullet)
  WHY: JD says "GPU-accelerated inference required." CUDA is the specific skill.
       Injecting it into the Laksh.ai bullet ties your existing project to the requirement.
       ATS will flag this match; recruiter will confirm it in your code.

  "MLflow" → line 22 (research tool bullet)  
  WHY: JD mentions "experiment tracking" 3 times. MLflow is the standard tool.
       Your existing bullet mentions "tracked experiments" — injecting MLflow makes
       the ATS match explicit while staying truthful.
```

### Job evaluation
After each score, explain the scoring so Parv can learn to eyeball fit:
```
Why 78/100 for [company]:
  Skills (90): You have PyTorch, CV, Python — all 3 required skills. Missing CUDA.
  Experience (85): They want interns or 0-2yr. You're a student. Clean match.
  Location (100): San Francisco listed. You're in Bay Area. 
  Visa (100): "We sponsor F-1" — explicit. No ambiguity.
  Company (70): Series B, but not AI-native. Standard prior.
  Timing (90): Posted 6 hours ago. High freshness.
```

### Form filling
Flag any screening question where the answer needs your judgment:
```
FLAGGED: "Describe your most relevant project"
  My answer: "Laksh.ai — real-time pose estimation system..."
  WHY FLAGGED: This is your best project but the JD emphasizes NLP, not CV.
  Consider: switching to Multi-Agent Research Tool for this specific role.
  Decision is yours — respond to update my draft.
```

## End-of-Session Summary

Command: `learn summary`

Output (exactly 3 sentences):
```
Session summary — [date]

BUILT: [What was built/done — 1 sentence, specific]
UNDERSTAND: [The key concept you should now understand from today's work — 1 sentence]  
STUDY: [The one thing you should look up or practice this week — 1 sentence]
```

Example:
```
BUILT: Implemented the Tracker module with dual-write persistence (JSON + markdown) and status transition logic.
UNDERSTAND: Separating ApplicationStore (persistence) from Tracker (business logic) means you can swap the storage backend without touching status transition rules — this is the Dependency Inversion Principle applied.
STUDY: Read about event sourcing — Tracker.recordEvaluation() currently overwrites, but an event log would let you audit every state change. Worth knowing before adding more status transitions.
```

## Friday Reconstruction Exercise

Command: `learn reconstruct [module]`

Rules:
- No reading source files during reconstruction
- Explain: what problem the module solves, the key classes, how data flows in and out
- After explaining, read the source and compare
- Note any gaps in your explanation — those are the concepts to reinforce
