const modelAliases: Record<string, string> = {
  "claude-opus-4-6[1M]": "claude-opus-4.6-1m",
  "claude-opus-4-6": "claude-opus-4.6-1m",
  "claude-sonnet-4-6": "claude-sonnet-4.6",
  "claude-haiku-4-5": "claude-haiku-4.5",
}

const reverseModelAliases = new Map<string, Array<string>>()
for (const [alias, canonical] of Object.entries(modelAliases)) {
  const aliases = reverseModelAliases.get(canonical) ?? []
  aliases.push(alias)
  reverseModelAliases.set(canonical, aliases)
}

export function normalizeModelName(modelId: string): string {
  return modelAliases[modelId] ?? modelId
}

export function getModelAliases(modelId: string): Array<string> {
  return reverseModelAliases.get(modelId) ?? []
}

export function expandModelIdsWithAliases(
  modelIds: Array<string>,
): Array<string> {
  const expandedModelIds: Array<string> = []
  const seenModelIds = new Set<string>()

  for (const modelId of modelIds) {
    for (const variant of [modelId, ...getModelAliases(modelId)]) {
      if (seenModelIds.has(variant)) {
        continue
      }
      seenModelIds.add(variant)
      expandedModelIds.push(variant)
    }
  }

  return expandedModelIds
}
