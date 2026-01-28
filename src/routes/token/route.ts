import { Hono } from "hono"

import { state } from "~/lib/state"
import { getCopilotToken } from "~/services/github/get-copilot-token"

export const tokenRoute = new Hono()

tokenRoute.get("/", (c) => {
  try {
    return c.json({
      token: state.copilotToken,
    })
  } catch (error) {
    console.error("Error fetching token:", error)
    return c.json({ error: "Failed to fetch token", token: null }, 500)
  }
})

tokenRoute.post("/refresh", async (c) => {
  try {
    const { token } = await getCopilotToken()
    state.copilotToken = token
    console.log("Copilot token manually refreshed")
    return c.json({
      success: true,
      message: "Token refreshed successfully",
    })
  } catch (error) {
    console.error("Error refreshing token:", error)
    return c.json({ error: "Failed to refresh token", success: false }, 500)
  }
})
