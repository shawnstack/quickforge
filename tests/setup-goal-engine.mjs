/**
 * Test harness default: the legacy goal engine.
 *
 * The product default is v2 (`DEFAULT_GOAL_SETTINGS.engine`), but the existing
 * suite encodes the legacy contract. Dedicated v2 tests create sessions with an
 * explicit `goalEngine: 'v2'`, so both engines stay covered without rewriting
 * every historical expectation.
 */
if (!process.env.QUICKFORGE_GOAL_ENGINE) process.env.QUICKFORGE_GOAL_ENGINE = 'legacy'
