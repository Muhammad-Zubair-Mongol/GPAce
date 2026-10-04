# Migration and rollback rehearsal

This runbook describes the disposable migration rehearsal for the sanitized corpus at `tests/fixtures/migration-corpus.json`. It does not authorize a read of `data/`, a browser profile, an authenticated account, or a production Firebase project. The Step 59 test uses an in-memory storage backend and synthetic identifiers only.

## Ownership boundary

The repository automatically migrates unscoped legacy keys only while the active repository user is anonymous. The anonymous namespace is `gpac_anon_`. An authenticated scope such as `gpac_u_<uid>_` never silently claims unowned legacy keys; `migrateOldData()` records a fresh authenticated scope and an explicit import is required. Draft keys that are outside the repository's recognized legacy task names remain in their original namespace until an owner explicitly imports them.

Recognized legacy names are:

- `tasks-<project>` for active project tasks
- `completed-tasks-<project>` for completion history
- `relaxed-tasks` for relaxed tasks
- `calculatedPriorityTasks` for the priority mirror

The migration writes canonical v5 envelopes under the active scoped prefix. A task payload is normalized before it is written, and the original legacy payload is copied to a `gpac_legacy_bak_<timestamp>_<legacy-key>` key before the source key is removed.

## State markers

The state is inspectable through the scoped storage namespace:

| Marker | Meaning |
| --- | --- |
| `gpac_anon_migration_done_v5=true` | The scope has committed the one-way migration boundary. A later read treats the marker as authoritative and does not revive legacy data. |
| `gpac_anon_schema_version=5` | The canonical schema marker written with the migration commit. |
| `gpac_anon_tasks_v5.<project>` / `gpac_anon_completed_v5.<project>` | Canonical v5 task and history envelopes. Valid, corrupt, and missing reads remain distinguishable. |
| `gpac_anon_backup_manual` | Migration backup containing task, history, relaxed, and priority data plus a checksum. |
| `gpac_legacy_bak_*` | Recoverable source copies retained from successfully converted legacy keys. |
| `gpac_anon_completion_tx_v1.<project>` | Step 50 completion journal. It must be preserved while verifying a rollback so history is not silently duplicated or discarded. |

The v5 envelope checksum is computed over its normalized `data` array. The manual backup checksum is computed over its complete `data` object. A backup is accepted for rollback only when its checksum recomputes exactly and its payload is then readable as valid v5 data.

## Resumability and interruption rehearsal

Migration is ordered per legacy key: read and parse the source, normalize it, write the v5 envelope, acknowledge the scoped state markers used by that write, copy the source to a legacy backup, and remove the source. A final marker and manual-backup pass follows the batch. A write failure is returned in the migration report and the source remains available when the failed boundary occurs before source removal.

The fixture test interrupts the migration at the v5 target, legacy backup, migration marker, and schema marker boundaries. It verifies that no source is treated as safely disposable before its destination write is acknowledged, that a failed report is observable, and that a clean rerun on a disposable copy reaches the same canonical IDs and history without duplication. The marker is intentionally authoritative: once `migration_done_v5` is true, a repeated call is a no-op. If a partial batch reports failure after that marker was committed, retain the source copy and use explicit recovery/import review rather than clearing markers in a live namespace.

## Rehearsal procedure

1. Load only `migration-corpus.json` into an isolated storage map and select the anonymous scope.
2. Record the raw legacy keys, the synthetic draft, and any unrelated sentinel key.
3. Run `migrateOldData()` and require a successful report before treating the result as committed.
4. Verify the migration and schema markers, every v5 envelope checksum, the manual backup checksum, and the `gpac_legacy_bak_*` source copies.
5. Read active tasks, completion history, tombstones, and the unrecognized draft. Compare IDs and content with the corpus.
6. Run migration again and require `alreadyCommitted` with `migrated: 0`; compare the canonical payloads with the first committed result.
7. For rollback rehearsal only, copy the isolated storage map, verify the manual backup checksum, mutate or remove canonical task/history envelopes in that copy, and call `forceRecoveryFromBackup('manual')`. Verify the pre-mutation IDs and history are restored, then discard the copy.

Rollback is a recovery action, not a migration retry. Never call it against a user namespace until the backup checksum, scope, owner, and intended restore slot have been reviewed. The Step 59 test creates and discards all state in disposable in-memory copies and performs no network or browser-profile access.

## Verification

```text
node tests/harness/run-case.cjs 59
```

The case must report zero skipped and zero todo tests. Expected injected storage interruptions may log a durability warning; the acceptance result must still show the source as recoverable and the final clean rehearsal as idempotent.
