import { BASELINE_VERSION, SQLITE_MIGRATIONS } from '../../server/sqlite/migrations.mjs'

/**
 * Schema-version helpers for SQLite tests.
 *
 * The compat-era migration chain is retired: the schema is created by a single
 * baseline migration (BASELINE_VERSION) and new migrations append after it.
 *
 * Deliberately narrow: these exist to *build* test fixtures (for example "one
 * migration past the end" for a deliberate-failure migration), never to assert
 * that a database sits at the latest version. Tests that care about migration
 * state should assert observable structure (tables, columns, indexes, row
 * contents) or fake the data instead.
 */
export const LATEST_SCHEMA_VERSION = SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1].version

/** Version number for a migration appended after the real list. */
export const NEXT_SCHEMA_VERSION = LATEST_SCHEMA_VERSION + 1

/** The version stamped by the baseline migration (first supported layout). */
export const BASE_SCHEMA_VERSION = BASELINE_VERSION
