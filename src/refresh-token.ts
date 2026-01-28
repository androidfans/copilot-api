import { defineCommand } from "citty"
import consola from "consola"

export const refreshToken = defineCommand({
  meta: {
    name: "refresh-token",
    description: "Manually refresh the Copilot token via API",
  },
  args: {
    port: {
      type: "string",
      alias: "p",
      default: "4141",
      description: "The port the server is running on",
    },
  },
  async run({ args }) {
    const port = args.port
    const url = `http://localhost:${port}/token/refresh`

    try {
      const response = await fetch(url, { method: "POST" })
      const data = await response.json()

      if (response.ok && data.success) {
        consola.success("Token refreshed successfully")
      } else {
        consola.error("Failed to refresh token:", data.error || "Unknown error")
        process.exit(1)
      }
    } catch (error) {
      consola.error("Failed to connect to server:", error)
      consola.info("Make sure the server is running on port", port)
      process.exit(1)
    }
  },
})
