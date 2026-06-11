---
name: tailor
description: Select the right resume variant, inject JD keywords, generate PDF, and optionally write a cover letter.
user_invocable: true
args: job_id_or_batch
---

# tailor — Resume & Cover Letter Tailoring

## Args
- `[job_id]` → tailor single job
- `batch [job_ids...]` → tailor multiple jobs sequentially
- `cover [job_id]` → cover letter only (resume already tailored)

## Pre-conditions
- Job must be in `data/applications.json` with score ≥ 50
- If score < 50 → refuse with message "Score below threshold. Not tailoring."

## Variant Selection Logic
```
title contains "ML" OR "machine learning" OR "deep learning" → cv/ml.md
title contains "AI" OR "artificial intelligence" OR "LLM" OR "generative" → cv/ai.md
title contains "robotics" OR "perception" OR "autonomous" OR "computer vision" → cv/robotics.md
title contains "campus" OR "student" OR "ambassador" OR "TA" OR "teaching" → cv/ta.md
else → cv/master.md
```

## Execution

### Resume tailoring
```
npm run tailor -- --job [job_id]
```

Output: `output/resumes/[job_id]-[variant].md` + `.pdf`

### Cover letter (only if score ≥ 60)
Before generating, you need:
1. Why this company specifically (from JD + quick research)
2. Strongest matching project from resume

Structure:
- **Para 1**: Why THIS company (specific detail from JD or company context — not generic)
- **Para 2**: Strongest matching project (name it, quantify it)
- **Para 3**: Experience alignment (1-2 relevant roles/projects)
- **Para 4**: What you bring (1 sentence, not a summary)

**Style rules** (non-negotiable):
- No em dashes
- No "passionate about", "excited to", "I believe", "I am confident"
- No AI-detectable filler phrases
- Conversational, direct
- Max 4 paragraphs

Output: `output/cover_letters/[job_id]-cover.md`

### PDF generation
```
npm run pdf -- --input output/resumes/[job_id]-[variant].md --output output/resumes/[job_id]-[variant].pdf
```

## Output per job
```
✅ Tailored: Acme Corp — ML Engineer Intern

Resume: output/resumes/test-001-ml.pdf
  Variant: ml.md
  Injected: "CUDA" (line 14 — ATS match for GPU requirement)
            "MLflow" (line 22 — experiment tracking keyword in JD)
            "Triton" (line 31 — inference requirement in JD)

Cover letter: output/cover_letters/test-001-cover.md
  Leads with: autonomous vehicle context from JD
  Project: Laksh.ai (pose estimation, deployed 10K+ users)
```

## Learning Output
Always explain EACH keyword injection:
- What keyword was injected
- Where (bullet/section)
- Why it helps (ATS parse, recruiter scan, or interview prep)
