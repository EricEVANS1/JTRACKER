# Debugging case studies

## JTR-DBG-0001 — Company logo resolver authentication

**Evidence:** [JWT diagnostics commit](https://github.com/EricEVANS1/JTRACKER/commit/07ba3fc539d37dfc4f488077ab01977b7233071e), [logo PR](https://github.com/EricEVANS1/JTRACKER/pull/15).

**Observed:** Commit title states that the active session JWT is passed explicitly for company-logo resolution and safe diagnostics are logged.

**Hypothesis / root cause:** Authentication propagation is a candidate explanation, but a confirmed root cause requires request logs and before/after reproduction. **Not independently established.**

**Fix evidence:** Linked code change. **Production fix not verified.**

**Next evidence:** Redacted failing request/response, relevant function logs, passing request, automated regression test, deployed function version.

## JTR-DBG-0002 — Flaky Companies-page browser test

**Evidence:** [commit 910f959](https://github.com/EricEVANS1/JTRACKER/commit/910f959a8a20ad81e96f7f0f1723f24b1124fb1a).

**Reported failure:** Test checked for a PATCH immediately after Save before the request was sent.

**Reported correction:** Poll for the request instead of checking immediately.

**Verification:** Commit message reports the scenario; independent CI run not yet inspected.

## JTR-DBG-0003 — CI browser runner and dependency hygiene

**Evidence:** [commit 2b21c1c](https://github.com/EricEVANS1/JTRACKER/commit/2b21c1c991c524dc3f61369f21dd10353a50e367).

**Reported issue:** Playwright Chromium installation failed on the ubuntu-latest runner before browser tests began.

**Reported correction:** Pin browser job to ubuntu-24.04; update vulnerable lockfile dependencies; stop tracking supabase/.temp.

**Reported verification:** Commit message claims lint, type checks, 164 unit tests, build, and 100 browser tests. These are **developer-reported, not independently verified** until matching CI logs are linked.

## Checkpoint template

```md
### [timestamp ISO-8601 / unknown] — checkpoint N
- Environment / branch / commit:
- Expected:
- Actual:
- Exact error (redacted):
- Reproduction steps:
- Hypothesis:
- Investigation performed:
- Observed evidence / links:
- Result: confirmed / rejected / inconclusive
- Next action:
```

Create checkpoints when events occur. Do not invent historical checkpoint timestamps.
