---
name: apply
description: Apply to jobs using MCP Playwright browser control. Visual form filling, Simplify integration, account creation. NEVER submits — user clicks Submit.
user_invocable: true
args: "[job_id | batch N | from ID | urls URL1 URL2...]"
---

# apply — MCP Playwright Form Filler

## ABSOLUTE RULE
**NEVER click Submit / Apply / Send / Confirm.** Fill everything. Stop. Show screenshot. User submits.

## Tools (MCP Playwright)
All browser control goes through `mcp__playwright__*` tools:
- `browser_navigate` — go to URL
- `browser_snapshot` — accessibility tree (labels, roles, refs) — USE THIS to find elements
- `browser_screenshot` — visual PNG — USE THIS to verify state and show user
- `browser_click` — click by ref from snapshot
- `browser_fill` — fill input by ref (fires React events correctly)
- `browser_type` — keystroke-by-keystroke (for masked/tricky fields)
- `browser_select_option` — dropdown by value or label
- `browser_check` / `browser_uncheck` — checkboxes
- `browser_press_key` — Tab, Enter, Escape, etc.
- `browser_scroll` — scroll to reveal more form fields
- `browser_file_upload` — attach a file to an input
- `browser_wait_for` — wait for element to appear
- `browser_tab_new` — open new tab
- `browser_tab_list` — list open tabs
- `browser_tab_select` — switch tabs
- `browser_handle_dialog` — dismiss alerts/confirms

## Profile Data (always read from config/profile.yml)
```
identity.name           → "Parv Patodia"
identity.email          → "patodia.pa@northeastern.edu"
identity.personal_email → "parvpatodia09@gmail.com"
identity.phone          → "555-555-0142"
identity.linkedin       → "https://linkedin.com/in/parvpatodia"
identity.github         → "https://github.com/parvpatodia"
identity.address        → "754 The Alameda, San Jose, CA 95126"
identity.city           → "San Jose"
identity.state          → "CA"
identity.zip            → "95126"
identity.university     → "Northeastern University Silicon Valley"
identity.gpa            → "3.917"
identity.graduation     → "May 2027"
accounts.app_password   → use for new account creation
```

## Field → Value Mapping
Match form labels to these values (case-insensitive fuzzy match):

| Form label contains... | Fill with |
|------------------------|-----------|
| first name, given name | Parv |
| last name, family name, surname | Patodia |
| full name, your name | Parv Patodia |
| email, e-mail | patodia.pa@northeastern.edu |
| phone, mobile, telephone | 555-555-0142 |
| linkedin, linkedin url | https://linkedin.com/in/parvpatodia |
| github, github url, portfolio, website, personal site | https://github.com/parvpatodia |
| address, street | 754 The Alameda |
| city | San Jose |
| state | CA / California |
| zip, postal code | 95126 |
| country | United States |
| university, school, institution | Northeastern University Silicon Valley |
| degree, qualification | Master of Science |
| major, field of study | Artificial Intelligence |
| gpa, grade | 3.917 |
| graduation date, expected graduation | May 2027 |
| start date, available from | May 2026 |
| term, session, co-op term, work term | Summer 2026 |
| years of experience | 2 |
| work authorization, authorized to work | Yes |
| require sponsorship (now) | No |
| require sponsorship (future/h1b) | Yes |
| us citizen, citizenship | No (I am on F-1 student visa) |
| security clearance | No |
| veteran | No |
| disability | Prefer not to say |
| gender | Male |
| ethnicity, race | Asian |
| how did you hear, source, referral | LinkedIn |
| salary, compensation (hourly) | 45 |
| salary, compensation (annual) | 140000 |
| relocation | Yes, willing to relocate |
| remote / hybrid / onsite preference | Open to all arrangements |
| cover letter (text field) | [first 400 chars of cv/cover_letter_ai.md] |
| referred by | [leave blank] |

## Invocation Modes

### Single job
```
/apply 038
```
Reads job 038 from data/applications.json, applies to it.

### Batch from queue
```
/apply batch 10
```
Takes next 10 Ready jobs from data/applications.json, applies sequentially.

### From a specific ID
```
/apply from 031
```
Starts from ID 031, processes up to 5 jobs.

### Direct URLs
```
/apply urls https://... https://... https://...
```
Apply to explicit URLs regardless of queue. Most useful when user is browsing a portal.

### Portal scan mode
```
/apply scan handshake
/apply scan linkedin ml intern
```
Navigate to portal, read job listings, open top matches in tabs.

---

## Per-Job Workflow

### Step 1 — Navigate & Assess
```
browser_navigate(url)
browser_snapshot()
```
Read the snapshot. Determine which case applies:

**A: Direct form visible** → jump to Step 4 (Fill)
**B: Apply / Easy Apply button** → Step 2 (Click Apply)
**C: Login wall** → Step 3a (Login)
**D: Create account page** → Step 3b (Create Account)
**E: Job listing page (apply link inside)** → find and click the apply link first

### Step 2 — Click Apply
Find the primary apply button in the snapshot. Labels to look for:
- "Apply", "Apply Now", "Easy Apply", "Quick Apply", "Apply for this job"
- "Apply Externally" → navigate to the external URL it links to
- LinkedIn "Easy Apply" button → click, wait for modal

```
browser_click(ref of apply button)
browser_wait_for("form, input, .application")
browser_snapshot()
```

### Step 3a — Login Wall
Look for "Sign in" / "Log in" form in snapshot.

1. Check if "Apply as guest" or "Continue without signing in" option exists → **always prefer guest**
2. If must log in: check if "Sign in with Google" / "Sign in with LinkedIn" button present → **prefer OAuth**
3. If email/password login only:
   ```
   browser_fill(email field, "patodia.pa@northeastern.edu")
   browser_fill(password field, accounts.app_password)
   browser_click(Sign in button)
   browser_wait_for("form, input")
   ```
4. If login fails: stop and tell user "Need to log in to [site] — Chrome window is open, please log in manually. I'll continue after you're in." Then `browser_wait_for` form to appear.

### Step 3b — Create Account
Use only if no guest option and OAuth not available.

1. Fill registration form:
   ```
   first name: Parv
   last name: Patodia
   email: patodia.pa@northeastern.edu
   password: [accounts.app_password from profile.yml]
   confirm password: [same]
   ```
2. Accept terms checkbox if present: `browser_check`
3. Click "Create Account" / "Register" / "Sign Up"
4. **Email verification needed**: Tell user "Check patodia.pa@northeastern.edu for a verification email from [site] and click the link." After they confirm: `browser_navigate(original job URL)` and continue.

### Step 4 — Try Simplify First
After form is open, BEFORE manual filling:

```
browser_snapshot()
```

Look in snapshot for Simplify's injected elements:
- Button/element with text: "Autofill", "Fill with Simplify", "Simplify"
- Any overlay button at top of form or floating on page

**If Simplify button found:**
```
browser_click(Simplify autofill button ref)
browser_wait_for(2000ms)
browser_snapshot()
```
Check what Simplify filled. Note fields left empty → go to Step 5 to fill gaps only.

**If Simplify NOT found:**
Continue to Step 5 (manual fill). Mention to user if this is the first session (Simplify may need to be installed — see Setup below).

### Step 5 — Manual Field Fill
Take fresh snapshot. For each visible form field:

1. Read accessible label from snapshot
2. Map to profile value using the table above
3. `browser_fill(ref, value)` for text inputs
4. `browser_select_option(ref, {label: value})` for dropdowns — try label first, then value
5. `browser_check(ref)` for checkboxes that should be checked
6. For radio groups: read all option labels, click the matching one
7. For textareas (cover letter, why this role): use cover letter text or compose brief 2-sentence answer from profile narrative

**Multi-step forms** (LinkedIn Easy Apply, Workday):
- Fill current page → find "Next" / "Continue" button → click it → snapshot again → repeat
- Stop at review/submit step — do NOT advance past it

**Scrolling for hidden fields:**
```
browser_scroll(direction: "down", amount: 500)
browser_snapshot()
```
Repeat until no new fields appear.

### Step 6 — File Uploads

**Resume:**
- Look in snapshot for file input, "Upload resume", "Attach CV"
- Determine variant from job's resumeVariant in applications.json:
  - `ai` → `output/resumes/parv-ai.pdf`
  - `ml` → `output/resumes/parv-ml.pdf`
  - `robotics` → `output/resumes/parv-robotics.pdf`
  - `ta` → `output/resumes/parv-ta.pdf`
  - `master` (default) → `output/resumes/parv-master.pdf`
- `browser_file_upload(ref, "/Users/parvpatodia/career-ops/output/resumes/parv-[variant].pdf")`

**Cover letter:**
- Look for "Upload cover letter", file input with name/id/label containing "cover"
- Role or URL contains robot/robotics/autonomous/perception/lidar/ROS → `cv/cover_letter_robotics.pdf`
- Default → `cv/cover_letter_ai.pdf`
- `browser_file_upload(cover ref, "/Users/parvpatodia/career-ops/cv/cover_letter_[variant].pdf")`

### Step 7 — Verify & Screenshot
```
browser_scroll(to top)
browser_screenshot()
```

Check the screenshot visually:
- ✓ Name, email, phone visible and correct
- ✓ Resume filename shows in upload field
- ✓ No red error highlights
- ✓ Required fields (*) not empty

Fix any errors, screenshot again.

### Step 8 — Stop & Report
**Do NOT click Submit.**

Print:
```
═══════════════════════════════════════
✓ READY FOR REVIEW — [Company] / [Role]
  ATS:       [greenhouse/lever/ashby/etc]
  Resume:    parv-[variant].pdf
  Cover:     cover_letter_[variant].pdf
  Simplify:  used / not present
  Flagged:   [any uncertain fields]

  → Chrome is open. Review and click Submit.
═══════════════════════════════════════
```

Ask: "Did you submit? (y to mark Applied, n to skip)"
If y → update data/applications.json: status = "Applied", appliedAt = now.

---

## Batch Workflow

For batch mode, open each job in a new tab for parallel review:

```
For each job in batch:
  browser_tab_new()
  browser_navigate(job URL)
  [run Steps 1-8]
```

After all tabs filled: `browser_tab_list()` → tell user all N tabs are ready in Chrome.

"I've filled [N] forms. Review each tab in Chrome and click Submit on each. Tell me which ones you submitted."

Then for each confirmed: update applications.json.

---

## Portal Scan Mode

When user says "scan handshake" or "scan linkedin ml intern":

1. `browser_navigate(portal search URL)`
2. `browser_snapshot()` — read job listing titles and links
3. Filter by relevance (ML/AI/robotics/SWE intern)
4. For each match (up to 5):
   - `browser_tab_new()`
   - `browser_navigate(job URL)`
   - Run per-job workflow

---

## ATS-Specific Notes

**Greenhouse** (`job-boards.greenhouse.io`, `boards.greenhouse.io`):
- No login required, single-page form
- Fields: name, email, phone, resume, LinkedIn, GitHub, custom questions
- Education section: Northeastern University Silicon Valley, MS Artificial Intelligence, May 2027

**Lever** (`jobs.lever.co`):
- No login required
- Short form: name, email, phone, resume, cover letter text
- "How did you hear?" → LinkedIn

**Ashby** (`jobs.ashbyhq.com`):
- No login required
- Similar to Greenhouse, often has demographic survey at end

**Workday** (`*.myworkdayjobs.com`):
- Requires account per company tenant
- Prefer "Apply with LinkedIn" if available
- If creating account: email + app_password
- Multi-step wizard — fill each step, stop at Review

**LinkedIn Easy Apply**:
- Requires LinkedIn login (saved in .browser-profile)
- Modal-based multi-step — fill each step, stop at Review page

**Handshake** (`app.joinhandshake.com`):
- Requires Handshake login (saved)
- Many postings have external ATS link — click it, apply there as Greenhouse/Lever/Ashby

---

## Error Handling

| Situation | Action |
|-----------|--------|
| CAPTCHA | Screenshot → "CAPTCHA on [site] — solve in Chrome window" → wait |
| Form submission error | Read error message from snapshot → fix that field |
| PDF upload fails | Retry `browser_file_upload`. If still fails, note in report |
| Posting expired / 404 | Mark Closed in applications.json, skip |
| Email verification needed | Tell user which inbox to check, wait for confirmation |
| Modal closes unexpectedly | Re-navigate to URL, start over from Step 1 |

---

## First-Time Setup (Simplify + Login)

If this is a fresh .browser-profile (first run):

1. `browser_navigate("https://chrome.google.com/webstore/detail/simplify-jobs/pbanhockgagggenencehbnadejlgchfc")`
2. Tell user: "Chrome is open — install Simplify from this page, then set up your profile in the Simplify extension. Take 2 minutes to do this once."
3. After user confirms Simplify setup: proceed with applying
4. For each platform (LinkedIn, Handshake), the first application will trigger login — session is saved after that

Account creation password for new portals: read from `config/profile.yml → accounts.app_password`. If missing, ask user once and save it.
