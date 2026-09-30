import { NextResponse } from "next/server"

export const runtime = "nodejs"

const JINA_EMBEDDINGS_URL = "https://api.jina.ai/v1/embeddings"
const JINA_EMBEDDING_MODEL = "jina-embeddings-v5-text-small"
const JINA_EMBEDDING_DIMENSIONS = 1024

const VALID_TASKS = new Set([
  "retrieval.query",
  "retrieval.passage",
  "text-matching",
  "classification",
  "clustering",
])

type JinaTask = "retrieval.query" | "retrieval.passage" | "text-matching" | "classification" | "clustering"

interface JinaEmbeddingItem {
  index: number
  embedding: number[]
}

interface JinaEmbeddingsResponse {
  data?: JinaEmbeddingItem[]
  detail?: string
}

async function fetchEmbeddings(inputs: string[], task: JinaTask | null): Promise<number[][]> {
  const apiKey = process.env.JINA_API_KEY?.trim()
  if (!apiKey) throw new Error("JINA_API_KEY not set")

  const nonEmpty = inputs.filter((s) => s.trim() !== "")
  if (nonEmpty.length === 0) return inputs.map(() => [])

  const body: Record<string, unknown> = {
    model: JINA_EMBEDDING_MODEL,
    input: nonEmpty,
    dimensions: JINA_EMBEDDING_DIMENSIONS,
    normalized: true,
    truncate: true,
  }
  if (task) {
    body.task = task
  }

  const response = await fetch(JINA_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  const payload = (await response.json().catch(() => null)) as JinaEmbeddingsResponse | null
  if (!response.ok) {
    throw new Error(payload?.detail ?? `Jina error ${response.status}`)
  }
  if (!payload?.data || payload.data.length !== nonEmpty.length) {
    throw new Error("Unexpected Jina response")
  }

  const sorted = [...payload.data].sort((a, b) => a.index - b.index).map((d) => d.embedding)

  const results: number[][] = []
  let sortedIdx = 0
  for (const input of inputs) {
    if (input.trim() === "") {
      results.push([])
    } else {
      results.push(sorted[sortedIdx++]!)
    }
  }
  return results
}

/** Dot product — equivalent to cosine similarity for L2-normalized vectors. */
function dotSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
  }
  return dot
}

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== "string") return ""
  return value.replace(/\r\n/g, "\n").trim()
}

function parseTask(value: unknown): JinaTask | null {
  if (typeof value !== "string" || value === "") return null
  if (VALID_TASKS.has(value)) return value as JinaTask
  return null
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      search,
      description,
      searchTask: rawSearchTask,
      passageTask: rawPassageTask,
    } = body as {
      search: string
      description: string
      searchTask: string
      passageTask: string
    }

    const searchTask = parseTask(rawSearchTask)
    const passageTask = parseTask(rawPassageTask)

    const searchText = normalizeText(search)
    const descText = normalizeText(description)

    if (searchText === "") {
      return NextResponse.json({ error: "Search query is required." }, { status: 400 })
    }

    const searchEmbeddings = await fetchEmbeddings([searchText], searchTask)
    const searchEmb = searchEmbeddings[0]!

    const descriptionEmbeddings = await fetchEmbeddings([descText], passageTask)
    const descEmb = descriptionEmbeddings[0]!

    const descSim = descEmb.length > 0 ? dotSimilarity(searchEmb, descEmb) : null

    return NextResponse.json({
      searchTask,
      passageTask,
      inputs: {
        search: searchText,
        description: descText,
      },
      embeddings: {
        search: searchEmb.slice(0, 8),
        description: descEmb.slice(0, 8),
      },
      similarities: {
        description: descSim,
      },
      scoring: {
        description: descSim ?? 0,
        formula: "note description cosine similarity",
        score: descSim ?? 0,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error" },
      { status: 500 },
    )
  }
}
