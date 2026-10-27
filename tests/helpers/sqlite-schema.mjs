import { SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'

/**
 * Schema-version helpers for SQLite tests.
 *
 * Deliberately narrow: these exist to *build* test fixtures (for example
 * "one migration past the end" for a deliberate-failure migration), never to
 * assert that a database sits at the latest version.
 *
 * Asserting `user_version === SQLITE_MIGRATIONS.length` restates the
 * implementation and stays true no matter which migration was botched, so
 * every schema bump used to require editing the same literal in several test
 * files. Tests that care about migration state should assert observable
 * structure (tables, columns, indexes, row contents) or fake the data instead.
 *
 * Historical boundaries ("a v11 database", "migration 12 fails") must stay
 * explicit literals: deriving them from the current migration list would
 * silently retarget those regression tests at the newest migrations.
 */
export const LATEST_SCHEMA_VERSION = SQLITE_MIGRATIONS.length

/** Version number for a migration appended after the real list. */
export const NEXT_SCHEMA_VERSION = LATEST_SCHEMA_VERSION + 1
