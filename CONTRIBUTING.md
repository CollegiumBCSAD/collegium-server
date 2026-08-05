# Contributing Guidelines

This document outlines the guidelines and conventions for contributing to `collegium-server`.

## Branching Strategy

- `main`: Production-ready code.
- `dev`: Default target branch for active development.

### Branch Naming
- `feat/<description>` for new features
- `fix/<description>` for bug fixes
- `docs/<description>` for documentation
- `refactor/<description>` for code refactoring
- `chore/<description>` for maintenance and dependencies

## Commit Message Conventions

Commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Formatting or code style changes (no logic change)
- `refactor`: Code refactoring without adding a feature or fixing a bug
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `build`: Changes to build system or dependencies
- `ci`: Changes to CI scripts or configuration
- `chore`: Maintenance tasks

### Scopes

Common scopes include: `auth`, `users`, `ranking`, `scrims`, `tournaments`, `prisma`, `redis`, `ci`.

### Guidelines
- Use imperative mood in the subject line (e.g., `add` instead of `added` or `adds`).
- Do not capitalize the first letter of the description unless it is a proper noun.
- Do not end the description with a period.
- For breaking changes, use `!` before the colon (e.g., `feat(auth)!: ...`) or include `BREAKING CHANGE:` in the body/footer.

### Examples
- `feat(auth): add google oauth callback logic`
- `fix(prisma): fix user relation mapping`
- `test(auth): add unit test for jwt strategy`

## Local Checks

Before submitting a pull request, run:

```bash
pnpm run lint
pnpm run format
pnpm run test
```

## Pull Request Process

1. Create your branch from `dev`.
2. Commit changes using Conventional Commits.
3. Ensure linting and tests pass.
4. Open a Pull Request targeting `dev`.
