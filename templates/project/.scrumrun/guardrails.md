# ScrumRun Project Guardrails - {{PROJECT_NAME}}

Canonical project policy. Universal method invariants live in `core.md`; this file contains stable owner/project constraints.

## GR-001 - Protect secrets

Status: active
Rule: Never commit or print real secrets. Keep local development values in `vault.local.md` and runtime values in environment/config.

## GR-002 - Preserve owner work

Status: active
Rule: Never overwrite unrelated or pre-existing owner changes. Canonical mutations must be scoped, lossless, validated, and recoverable.

## GR-003 - Respect read-only paths

Status: active
Rule: Never modify a path marked read-only by the owner or project configuration.

## GR-004 - Approval gates execution

Status: active
Rule: Intake remains read-only. Create/update a Task and create a Run only after explicit valid approval.
