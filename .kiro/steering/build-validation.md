---
alwaysApply: true
---

# Build Validation Rule

**A task is NOT done until the build passes with zero errors.**

After every code change, run both checks before marking the task complete:

```bash
npx tsc --noEmit   # must exit 0 with no errors
npx vite build     # must succeed (✓ built)
```

If either fails:
1. Read the full error output
2. Fix all errors
3. Re-run both checks
4. Only then mark the task done

Never skip this step. Never assume the code is correct without running the build.
