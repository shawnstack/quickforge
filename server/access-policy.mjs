export function isAuthenticatedAppClient(context = {}) {
  if (context.isLocalRequest === true) return true
  return context.isLocalRequest === false && context.remoteAuthorized === true
}
