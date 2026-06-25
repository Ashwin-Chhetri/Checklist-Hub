# Reconciliation Engine

Stubbed in V1. Per the implementation plan (Phase 6), this module will compare
multiple checklists for the same region and surface:

- Shared species
- Missing species
- Synonym conflicts
- Taxonomic differences

No services/hooks exist yet - add `services/reconciliationService.ts` and
`hooks/useChecklistComparison.ts` when this phase starts.
