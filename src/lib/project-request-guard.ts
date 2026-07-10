export type ProjectRequestToken = Readonly<{
  projectId: string
  requestId: number
}>

export function isCurrentProjectRequest(
  token: ProjectRequestToken,
  currentProjectId: string | undefined,
  currentRequestId: number,
) {
  return token.projectId === currentProjectId && token.requestId === currentRequestId
}
