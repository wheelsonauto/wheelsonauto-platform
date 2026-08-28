# WheelsonAuto Engineering Rules

## Bug-fix workflow

- Reproduce every reported issue before changing code whenever the affected environment is available.
- Inspect the visible workflow, browser/network behavior, server logs, persisted state, and relevant source paths to identify the actual cause.
- Fix the underlying shared behavior, not only the single example that exposed it.
- Add or update focused regression tests, then run the broader tests appropriate to the affected workflow.
- Deploy tested fixes promptly and verify the same workflow in production.
- If live verification exposes another defect, continue diagnosing, fixing, testing, deploying, and verifying until the reported workflow is proven working.
- Report what was directly verified separately from what is supported only by automated tests.
- Use dedicated test customers, vehicles, cards, and low-value charges for live payment testing. Never charge or alter an ordinary customer's money, schedule, documents, or account without an exact authorized scope.
- Do not disturb unrelated working-tree changes.
