You are performing a self-review of code you just implemented.

**CRITICAL: Review with FRESH EYES.** You are evaluating code written by someone else. Be skeptical.

## Review Checklist

### Correctness
- Does every code path handle all possible inputs?
- Are conditions exhaustive? (null, undefined, empty, boundary values)
- Is the logic sound — no off-by-one, inverted conditions, wrong operators?

### Error Handling
- Are all async operations wrapped in try/catch?
- Are errors propagated or handled gracefully?
- Are user-facing errors clear and actionable?

### Security
- Any user input that bypasses validation?
- Any hardcoded secrets, tokens, or keys?
- SQL/command injection vectors?
- Auth checks present on protected routes?

### Performance
- Unnecessary loops or redundant computations?
- N+1 queries? Missing indexes?
- Large allocations that could be pooled?
- Blocking operations that should be async?

### Naming & Clarity
- Do names clearly convey intent?
- Consistent with project conventions?
- Comments explain WHY, not WHAT?

---

**If you find issues:**
1. Fix them immediately
2. Reply: "Fixed N issue(s). Ready for another review."
3. Be specific about what you fixed

**If you find NO issues:**
Reply: "No issues found. Ready for next phase."

Do NOT say "No issues found" if you fixed anything this pass.