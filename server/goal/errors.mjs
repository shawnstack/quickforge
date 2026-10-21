/**
 * Stable Goal v2 errors.
 *
 * The HTTP route, the model tools and the tests all rely on `code`; `message`
 * stays human-readable and may be localized by the caller.
 */

export const GOAL_ERROR_CODES = Object.freeze({
  NOT_FOUND: 'GOAL_NOT_FOUND',
  ALREADY_EXISTS: 'GOAL_ALREADY_EXISTS',
  REVISION_CONFLICT: 'GOAL_REVISION_CONFLICT',
  INVALID_TRANSITION: 'GOAL_INVALID_TRANSITION',
  INVALID_INPUT: 'GOAL_INVALID_INPUT',
  ROUND_LIMIT: 'GOAL_ROUND_LIMIT',
  NOT_ACTIVE: 'GOAL_NOT_ACTIVE',
  BUSY: 'GOAL_BUSY',
  UNAVAILABLE: 'GOAL_UNAVAILABLE',
  PERSIST_FAILED: 'GOAL_PERSIST_FAILED',
})

export class GoalError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {number} [statusCode]
   */
  constructor(message, code = GOAL_ERROR_CODES.INVALID_TRANSITION, statusCode = 409) {
    super(message)
    this.name = 'GoalError'
    this.code = code
    this.statusCode = statusCode
  }
}
