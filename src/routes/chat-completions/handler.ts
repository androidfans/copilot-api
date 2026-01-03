import type { ServerSentEventMessage } from "fetch-event-stream"
import type { Context } from "hono"

import consola from "consola"
import { streamSSE, type SSEMessage } from "hono/streaming"

import { awaitApproval } from "~/lib/approval"
import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import { getTokenCount } from "~/lib/tokenizer"
import { isNullish } from "~/lib/utils"
import {
  createChatCompletionsStream,
  type ChatCompletionChunk,
  type ChatCompletionResponse,
  type ChatCompletionsPayload,
} from "~/services/copilot/create-chat-completions"

export async function handleCompletion(c: Context) {
  await checkRateLimit(state)

  let payload = await c.req.json<ChatCompletionsPayload>()
  consola.debug("Request payload:", JSON.stringify(payload).slice(-400))

  // Find the selected model
  const selectedModel = state.models?.data.find(
    (model) => model.id === payload.model,
  )

  // Calculate and display token count
  try {
    if (selectedModel) {
      const tokenCount = await getTokenCount(payload, selectedModel)
      consola.info("Current token count:", tokenCount)
    } else {
      consola.warn("No model selected, skipping token count calculation")
    }
  } catch (error) {
    consola.warn("Failed to calculate token count:", error)
  }

  if (state.manualApprove) await awaitApproval()

  if (isNullish(payload.max_tokens)) {
    payload = {
      ...payload,
      max_tokens: selectedModel?.capabilities.limits.max_output_tokens,
    }
    consola.debug("Set max_tokens to:", JSON.stringify(payload.max_tokens))
  }

  // 记录客户端是否请求流式响应
  const clientWantsStream = payload.stream === true

  // 内部始终使用流式模式，避免长时间请求超时导致 ECONNRESET
  const response = await createChatCompletionsStream(payload)

  // 如果客户端请求流式响应，直接透传
  if (clientWantsStream) {
    consola.debug("Streaming response")
    return streamSSE(c, async (stream) => {
      for await (const chunk of response) {
        consola.debug("Streaming chunk:", JSON.stringify(chunk))
        await stream.writeSSE(chunk as SSEMessage)
      }
    })
  }

  consola.info(
    "Client requested non-streaming response; using upstream streaming and collecting chunks",
  )

  // 客户端请求非流式响应，收集流式数据块并合并
  consola.debug("Collecting stream chunks for non-streaming response")
  const nonStreamResponse = await collectStreamToResponse(response)
  consola.debug("Non-streaming response:", JSON.stringify(nonStreamResponse))
  return c.json(nonStreamResponse)
}

type FinishReason = "stop" | "length" | "tool_calls" | "content_filter"

type ToolCallAccumulator = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

type StreamAccumulator = {
  id: string
  model: string
  created: number
  systemFingerprint?: string
  finishReason: FinishReason
  content: string
  toolCalls: Map<number, ToolCallAccumulator>
  usage?: ChatCompletionResponse["usage"]
}

/**
 * 将流式响应的数据块合并为非流式响应格式
 */
async function collectStreamToResponse(
  stream: AsyncGenerator<ServerSentEventMessage, void, unknown>,
): Promise<ChatCompletionResponse> {
  const accumulator = createAccumulator()

  for await (const chunk of stream) {
    if (!chunk.data) continue
    if (chunk.data === "[DONE]") break

    const parsed = parseChunkDataOrLog(chunk.data)
    if (!parsed) continue
    applyChunkToAccumulator(parsed, accumulator)
  }

  return buildResponse(accumulator)
}

function createAccumulator(): StreamAccumulator {
  return {
    id: "",
    model: "",
    created: 0,
    finishReason: "stop",
    content: "",
    toolCalls: new Map(),
  }
}

function parseChunkDataOrLog(data: unknown): ChatCompletionChunk | null {
  if (typeof data !== "string") return null

  try {
    return JSON.parse(data) as ChatCompletionChunk
  } catch (error) {
    consola.debug("Failed to parse SSE chunk data", {
      dataPreview: data.slice(0, 500),
      error,
    })
    return null
  }
}

function applyChunkToAccumulator(
  parsed: ChatCompletionChunk,
  accumulator: StreamAccumulator,
) {
  if (!accumulator.id && parsed.id) accumulator.id = parsed.id
  if (!accumulator.model && parsed.model) accumulator.model = parsed.model
  if (!accumulator.created && parsed.created)
    accumulator.created = parsed.created
  if (!accumulator.systemFingerprint && parsed.system_fingerprint) {
    accumulator.systemFingerprint = parsed.system_fingerprint
  }
  if (parsed.usage) accumulator.usage = parsed.usage

  const choice = parsed.choices.at(0)
  if (!choice) return

  if (choice.finish_reason) accumulator.finishReason = choice.finish_reason

  if (typeof choice.delta.content === "string") {
    accumulator.content += choice.delta.content
  }

  if (choice.delta.tool_calls) {
    mergeToolCalls(accumulator.toolCalls, choice.delta.tool_calls)
  }
}

function mergeToolCalls(
  toolCalls: Map<number, ToolCallAccumulator>,
  deltas: NonNullable<
    ChatCompletionChunk["choices"][number]["delta"]["tool_calls"]
  >,
) {
  for (const delta of deltas) {
    const existing = toolCalls.get(delta.index)
    if (!existing) {
      toolCalls.set(delta.index, {
        id: delta.id ?? "",
        type: "function",
        function: {
          name: delta.function?.name ?? "",
          arguments: delta.function?.arguments ?? "",
        },
      })
      continue
    }

    if (!existing.id && delta.id) existing.id = delta.id
    if (!existing.function.name && delta.function?.name) {
      existing.function.name = delta.function.name
    }
    if (delta.function?.arguments) {
      existing.function.arguments += delta.function.arguments
    }
  }
}

function buildResponse(accumulator: StreamAccumulator): ChatCompletionResponse {
  const response: ChatCompletionResponse = {
    id: accumulator.id,
    object: "chat.completion",
    created: accumulator.created,
    model: accumulator.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: accumulator.content || null,
          ...(accumulator.toolCalls.size > 0 && {
            tool_calls: Array.from(accumulator.toolCalls.values()),
          }),
        },
        logprobs: null,
        finish_reason: accumulator.finishReason,
      },
    ],
  }

  if (accumulator.systemFingerprint) {
    response.system_fingerprint = accumulator.systemFingerprint
  }
  if (accumulator.usage) response.usage = accumulator.usage

  return response
}
