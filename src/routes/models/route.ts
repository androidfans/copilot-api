import { Hono } from "hono"

import { forwardError } from "~/lib/error"
import {
  expandModelIdsWithAliases,
  normalizeModelName,
} from "~/lib/model-normalization"
import { state } from "~/lib/state"
import { cacheModels } from "~/lib/utils"

export const modelRoutes = new Hono()

modelRoutes.get("/", async (c) => {
  try {
    if (!state.models) {
      // This should be handled by startup logic, but as a fallback.
      await cacheModels()
    }

    const modelById = new Map(
      state.models?.data.map((model) => [model.id, model]),
    )
    const modelIds = expandModelIdsWithAliases(
      state.models?.data.map((model) => model.id) ?? [],
    )
    const models = modelIds.flatMap((modelId) => {
      const sourceModel = modelById.get(normalizeModelName(modelId))
      if (!sourceModel) return []

      return {
        id: modelId,
        object: "model",
        type: "model",
        created: 0, // No date available from source
        created_at: new Date(0).toISOString(), // No date available from source
        owned_by: sourceModel.vendor,
        display_name: sourceModel.name,
      }
    })

    return c.json({
      object: "list",
      data: models,
      has_more: false,
    })
  } catch (error) {
    return await forwardError(c, error)
  }
})
