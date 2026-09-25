# River migration reconciliation

This directory records the tested chain mirrored in the active `supabase/migrations` folder for linked River project `azukfrqscyqttlirdeiy`. The approved production repair was completed on 23 September 2026. All eleven migration versions now match remotely. The bot-observation migration remains pending and was not deployed.

## Contents and provenance

The migration chain contains eleven files in timestamp order:

- Six historical SQL bodies recovered from the corresponding rows of `supabase_migrations.schema_migrations` on the linked project: the initial schema, 3B contract, 3B idempotency, developer role, no-lockout adjustment, and rescue-threshold adjustment. Their SQL matched the independently replayed temporary copies after whitespace normalisation.
- Three existing repo files copied without semantic changes: 5K economy schema, table items, and cosmetics. The table-items timestamp is already present in remote history, although that history row has no stored SQL body. Its rebuilt schema matches the live object definitions.
- `20260923110000_explicit_inventory_grants.sql` grants authenticated users read access to their RLS-protected inventory and gives the server service role the read/write privileges its REST stores use. It does not copy the hosted project's broader implicit grants or revoke existing permissions.
- `20260923120000_ledger_restrict_contract.sql` changes the two ledger-related foreign keys to `ON DELETE RESTRICT`, validates a 1–128 character ledger reference, and makes the reference non-null. It is transactional and has a five-second lock timeout. Existing live references passed a read-only null, empty, length, and duplicate preflight on 23 September; those checks must be repeated before deployment.

The seven superseded local-only migrations were moved to `supabase/migration-archive/pre-20260923/` without semantic changes. The pending bot-observation migration was moved to `supabase/pending/` without semantic changes. The active folder contains the same eleven filenames and SQL bodies as this candidate.

## Local proof on 23 September

An unlinked, disposable local Supabase project reset cleanly from these eleven files with no seed. The economy configuration and seven daily-bonus rows matched the linked project. Local service-role REST reads returned HTTP 200 for balances, both economy views, table items, and cosmetics. The minimum inventory role grants were verified, and anon insert was denied. A rolled-back local Auth-user fixture demonstrated that user deletion is rejected while its ledger row remains. The fixture left no rows behind.

Before production deployment, a schema-only comparison differed in the intended new ledger constraints and in grants/default privileges. The latter reflect different platform defaults between the older hosted project and current local stack; broader hosted default grants were not copied. The production constraints and grants were independently checked after deployment.

## Executed production gate

1. A manual logical backup of app and Auth schema/data, roles and migration history was verified outside the repository. The linked project reference and live ledger-data preflight passed. Gameplay was not frozen; the backup is a time-stamped recovery point, not a cross-file database snapshot.
2. With Zain's approval, only already-live versions `20260824223437` (5K economy) and `20260825090000` (cosmetics) were marked applied in remote history. The old 4E/4H and local 3B timestamp variants were not marked applied.
3. `supabase db push --linked --dry-run --skip-vault` listed exactly `20260923110000_explicit_inventory_grants.sql` and `20260923120000_ledger_restrict_contract.sql`.
4. `supabase db push --linked --skip-vault --yes` applied exactly those two files. Both foreign keys now validate as `ON DELETE RESTRICT`; the ledger reference check validates and `ref` is non-null. The required inventory, economy, balance and ledger-RPC role privileges remained present. Auth signup trigger and economy configuration remained present. The bot table remained absent.
5. A final migration list showed eleven local/remote matches and a final dry run returned `upToDate: true` with no migrations. The post-push read-only check found 170 Auth users, 170 players, 489 ledger rows, and zero invalid or duplicate refs. The ledger row count rose during this active-gameplay window; no decrease was observed.

No linked reset, `--include-all`, bot-table deployment, bot-persistence activation or default-grant change was performed. The retained private execution log is `docs/private/supabase-migration-reconciliation.md`. Bot persistence remains disabled until its own migration and canary pass.
