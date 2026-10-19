/**
 * Test harness: legacy goal tests still exercise the old 13-status contract.
 * Production defaults to v2; this override exists only for the test suite.
 */
if (!process.env.QUICKFORGE_GOAL_ENGINE) process.env.QUICKFORGE_GOAL_ENGINE = 'legacy'
