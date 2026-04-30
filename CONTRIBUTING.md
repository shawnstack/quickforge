# Contributing to QuickForge

Thanks for your interest in contributing!

## Getting Started

```bash
git clone https://github.com/YOUR_USERNAME/quickforge.git
cd quickforge
npm install
npm run dev
```

This starts the local API server and Vite dev server on `http://127.0.0.1:5176`.

## Development Workflow

1. Create a branch: `git checkout -b feature/my-feature`
2. Make your changes
3. Run lint: `npm run lint`
4. Verify build: `npm run build`
5. Commit and push
6. Open a pull request

## Project Structure

| Path | Purpose |
|---|---|
| `src/` | React frontend (Vite + Tailwind CSS) |
| `server/index.mjs` | Local Node.js API / storage server |
| `bin/quickforge.mjs` | CLI entry point |
| `public/` | Static assets |

## Code Style

- TypeScript with strict mode for the frontend
- ESLint with the project config (`eslint.config.js`)
- Use Tailwind utility classes for styling (shadcn-style components)

## Pull Request Guidelines

- Keep PRs focused on a single change
- Update the CHANGELOG if applicable
- Ensure `npm run lint` and `npm run build` pass
- Link related issues in the description

## Questions?

Open an issue or start a discussion.
