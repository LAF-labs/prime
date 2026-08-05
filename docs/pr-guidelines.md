# Pull request guidelines

## Title

Use conventional commit format:

```
type(scope): short description
```

Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `ci`, `perf`, `test`

Keep it under 72 characters. Use imperative mood ("add feature" not "added feature").

## Description content

Every PR description must include these sections:

### What

- One to three sentences describing the change.
- List affected components, commands, or modules.
- Mention new files or deleted files if relevant.

### Why

- Link the issue or discussion that motivated the change (`Closes #123`).
- If there's no issue, explain the problem or user need in two sentences max.
- For refactors, state what was wrong with the previous approach.

### How to test

- Provide exact steps a reviewer can follow to verify the change.
- Include commands (`bun run dev`, `cargo test`, etc.).
- Call out edge cases the reviewer should check.

### Screenshots

- Required for any UI change (layout, styling, new component).
- Use before/after screenshots when modifying existing UI.
- Animated GIFs or recordings for interaction changes.

### Breaking changes

- If the PR introduces a breaking change, add a `BREAKING CHANGE:` section.
- Describe what breaks and the migration path.

### Template

```markdown
## What

Brief summary of the change. List affected areas.

## Why

Context, issue link, or problem statement.

## How to test

1. Run `bun run dev`
2. Navigate to ...
3. Verify ...

## Screenshots

(if applicable)

## Breaking changes

(if applicable) Describe what breaks and how to migrate.
```

## Conditions

- Title must match conventional commit format
- Description must not be empty
- Link related issues with `Closes #123` or `Fixes #123`
- UI changes require a screenshot
- Breaking changes must include `BREAKING CHANGE:` in the body
