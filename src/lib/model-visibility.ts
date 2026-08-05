export type QuickForgeModelVisibility = {
  quickforgeHidden?: boolean
}

export function isModelSelectable(model: object): boolean {
  return (model as QuickForgeModelVisibility).quickforgeHidden !== true
}

export function filterSelectableModels<T extends object>(models: T[]): T[] {
  return models.filter(isModelSelectable)
}
