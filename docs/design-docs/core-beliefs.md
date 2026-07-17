# Core beliefs

Status: Accepted

Last verified: 2026-07-17

1. **The repository is the system of record.** A decision unavailable in the
   repository is unavailable to a future contributor or agent.
2. **Progressive disclosure beats a giant manual.** `AGENTS.md` is a concise
   map; focused documents hold the detail.
3. **Feedback loops are product infrastructure.** Local checks, deterministic
   tests, CI, structured logs, and inspectable state make autonomous work safe.
4. **Enforce invariants, allow local choice.** Security, privacy, dependency
   direction, idempotency, and lifecycle behavior are mechanical constraints;
   implementation expression inside those constraints can vary.
5. **Validate at boundaries.** Never build behavior on guessed external data
   shapes or probe production payloads until something appears to work.
6. **Plans and debt are versioned artifacts.** Significant work preserves its
   intent, decisions, progress, and validation evidence in the repository.
7. **Turn recurring taste into tooling.** Repeated feedback should become a
   documented principle and, where objective, a test or lint.
8. **Prefer the simplest inspectable system.** Add services such as queues only
   after measured load or reliability evidence justifies them.
