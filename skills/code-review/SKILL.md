# Code Review Skill

Use this skill when the user asks for code review, PR review, bug finding, or quality checks.

## Workflow

1. Understand the requested change and inspect the relevant files before judging.
2. Focus on correctness, regressions, security, data loss, performance, and maintainability.
3. Prefer concrete findings over generic advice.
4. If proposing changes, keep them small and directly related to the review.
5. Verify with targeted tests, lint, typecheck, build, or a focused command when practical.

## Output

- Start with the highest-risk findings.
- For each finding include the file/location, risk, why it matters, and a concise fix.
- If no major issues are found, say so clearly and mention any checks performed.
