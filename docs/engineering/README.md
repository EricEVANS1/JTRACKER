# JTracker engineering evidence portfolio

Created 2026-11-18. Historical coverage target: January 2026 onward. **This documentation was created now, not backdated.**

## Purpose
Preserve independently checkable evidence of engineering work: requirements, implementation, debugging checkpoints, tests, deployment, and lessons. Git commits alone establish code changes, not necessarily the identity or extent of individual human contribution.

## Evidence grades
- **Verified technical evidence**: linked commit, PR, or machine-readable CI result directly establishes the stated event.
- **Contemporaneous note**: dated discussion or issue describes the event; not independently proven.
- **Incomplete reconstruction**: plausible linkage, missing logs or dates.
- **Unverified**: claim not supported by accessible records.

## Required fields for each record
Record ID; occurrence date/time and timezone (or unknown); documentation date; requirement; expected/actual behavior; reproduction; exact error and sanitized logs; hypotheses and investigation checkpoints; root cause (or unknown); rejected approaches; changes and commit/PR links; tests and actual results; deployment verification; remaining risk; lessons; skills; author/human contribution versus AI assistance; evidence grade; optional XP.

Never invent a reproduction, outcome, timestamp, test pass, deployment, or individual authorship. Redact secrets, CVs, private user information, and tokens.

## Workflow
1. Before changes: create issue/record and acceptance criteria.
2. On each meaningful failure or hypothesis change: append timestamped checkpoint.
3. At fix: link the exact diff and root-cause evidence.
4. At verification: capture test command, run URL, exit code, environment and result.
5. At deployment: capture release SHA and production smoke-test evidence.
6. At retrospective: distinguish demonstrated skills from inferred skills.
7. Link documentation from PR; use review and merge into main after approval.

## Index
- [2026 timeline](timeline/2026.md)
- [Debugging case studies](debugging/README.md)
- [Experience ledger](experience-ledger.csv)

The historical reconstruction is **partial**. January project start is user-reported, not established by the evidence sampled here. Commit messages reporting test results are not equivalent to independently retrieved CI logs.
