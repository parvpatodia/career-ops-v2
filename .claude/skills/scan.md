---
name: scan
description: Discover new job listings across configured platforms (LinkedIn, Wellfound, Handshake, SWEList, Google Jobs)
user_invocable: true
args: platform
---

# scan — Job Discovery

## Goal
Discover new job listings matching Parv's profile. Deduplicate. Cache results. Return ranked list.

## Args
- (empty) → scan all enabled platforms
- `linkedin` / `wellfound` / `handshake` / `swelist` / `googlejobs` → single platform
- `url [url]` → scan a specific company careers page directly

## Execution

### 1. Pre-flight checks
```
validate config/profile.yml
validate config/platforms.yml (at least one enabled)
check data/daily_log/[today]-*.json for existing cache hits
```

### 2. Run scanner
```
npm run scan -- --platform [arg or "all"]
```

Parse JSON output: `{ count: N, jobs: [...] }`

### 3. Dedup against existing applications
Read `data/applications.json`. For each job in results:
- If `company + role` already in tracker → mark as KNOWN, skip
- Else → mark as NEW

### 4. Output

Print table of NEW discoveries:

```
Found [N] new jobs ([M] already tracked)

 #  | Company          | Role                        | Score | Platform   | Posted
----|------------------|-----------------------------|-------|------------|-------
 1  | Acme Corp        | ML Engineer Intern          | —     | linkedin   | 2h ago
 2  | BetaAI           | Computer Vision Intern      | —     | wellfound  | 5h ago
...

Run `eval top [N]` to score these. Or `eval batch` to score all.
```

### 5. Rate limit check
If platform is `linkedin`: confirm today's count < 25 before scanning.

## Edge Cases
- Platform auth fails → warn, continue with other platforms
- Cache hit for all platforms → report "All results from today's cache"
- Zero new results → "No new jobs found. Cache is current."
