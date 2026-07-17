# Agent-first repository harness

Status: Completed

Started: 2026-07-17

Completed: 2026-07-17

## Goal and acceptance criteria

Apply the useful principles from OpenAI's harness-engineering article to the
current repository: make knowledge discoverable, provide a fast deterministic
feedback loop, record quality gaps honestly, and enforce documentation shape
without introducing infrastructure the placeholder Worker cannot yet use.

## Context and constraints

The repository began with a detailed product boundary, a placeholder Worker,
Biome, TypeScript, and Wrangler. It had no agent guide, architecture map, tests,
working validation command, CI, or structured planning history.

## Plan

1. Audit the repository and distinguish implemented behavior from proposals.
2. Add a concise agent map and indexed, progressively disclosed knowledge base.
3. Add executable format, lint, type, test, and documentation checks.
4. Run those checks and record remaining gaps.

## Progress

All four steps were completed. The knowledge validator checks required files,
index coverage, the size and key links of `AGENTS.md`, and 180-day freshness for
operational source documents.

## Decisions

- Keep the detailed root README as the single product specification for now to
  avoid duplicating a source of truth.
- Document the intended layered architecture, but defer import-boundary linting
  until multiple runtime modules exist.
- Use Vitest with Cloudflare's Workers pool so tests execute in the target
  runtime and can grow into binding-backed integration tests.
- Do not add a local observability stack, D1, Queues, or deployment automation
  before application behavior exists and creates a concrete validation need.

## Validation

`npm run check` is the local and CI entry point. Final command output is recorded
in the implementing change's handoff and CI run.

## Follow-ups

The quality score lists the next feedback loops: domain unit tests, a D1
integration harness, shared ingest-contract fixtures, structured log assertions,
preview deployment, and migration validation.
