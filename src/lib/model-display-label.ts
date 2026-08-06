type ModelIdentity = {
  provider: string
  id: string
}

export function modelDisplayLabel(model: ModelIdentity): string {
  return `${model.provider} / ${model.id}`
}
