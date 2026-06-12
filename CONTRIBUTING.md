# Contributing to Cu Agent

Thanks for your interest! 🎉 Cu Agent is early-stage, so issues, ideas, and PRs are all welcome.

## Getting started

```bash
git clone https://github.com/Wang-Yeah623/cu-agent.git
cd cu-agent
npm install
npm test            # run the test suite
npx tsc --noEmit    # type-check
```

## Before you open a PR

- ✅ `npx tsc --noEmit` is clean (the test runner uses esbuild and does **not** type-check, so always run `tsc` too).
- ✅ `npm test` is green. Integration tests need a mock model on port `11434`:
  ```bash
  npx tsx tests/mock-hermes.ts   # in one terminal
  npm test                       # in another
  ```
- ✅ Keep changes focused; match the surrounding code style.
- ✅ Update the README / docs if you change behavior or config.

## Project layout

- `src/` — the Host (Node/TypeScript). See the architecture map in the [README](README.md).
- `cu-plugin-codex/` — the VS Code extension (its own `package.json` / build; press **F5** to run).

## Reporting bugs

Open an issue with: what you ran, what you expected, what happened, and your env (OS, Node version, model/endpoint). Logs from `console` and `…/profiles/.../logs` help a lot.

## Code of conduct

Be kind and constructive. We're all here to build something fun.
