"use client"

import { useState } from "react"
import { Button, Text, TextInput, Loader, Select } from "@gravity-ui/uikit"
import styles from "./page.module.css"

const CAT_COUNT = 8

const TASK_OPTIONS = [
  { value: "", content: "(none — Jina default)" },
  { value: "retrieval.query", content: "retrieval.query" },
  { value: "retrieval.passage", content: "retrieval.passage" },
  { value: "text-matching", content: "text-matching" },
  { value: "classification", content: "classification" },
  { value: "clustering", content: "clustering" },
]

const DEFAULT_SEARCH_TASK = "retrieval.query"
const DEFAULT_PASSAGE_TASK = "retrieval.passage"

interface DebugResult {
  searchTask: string | null
  passageTask: string | null
  inputs: {
    search: string
    description: string
    tags: string[]
  }
  embeddings: {
    search: number[]
    description: number[]
    tags: number[][]
  }
  similarities: {
    description: number | null
    tags: (number | null)[]
    avgTag: number | null
  }
  scoring: {
    description: number
    avgTag: number
    formula: string
    compositeScore: number
  }
}

function formatSim(value: number | null): string {
  if (value === null) return "n/a"
  return value.toFixed(6)
}

function formatPct(value: number | null): string {
  if (value === null) return "n/a"
  return `${(value * 100).toFixed(2)}%`
}

function simColor(value: number | null): string {
  if (value === null) return "var(--g-color-text-secondary)"
  if (value >= 0.5) return "var(--g-color-text-positive)"
  if (value >= 0.35) return "#e8c547"
  if (value >= 0.2) return "var(--g-color-text-warning)"
  return "var(--g-color-text-danger)"
}

function EmbeddingPreview({ values }: { values: number[] }) {
  if (values.length === 0) return <span className={styles.dimText}>(empty)</span>
  return (
    <span className={styles.embeddingPreview}>
      [{values.map((v) => v.toFixed(4)).join(", ")}, ...]
    </span>
  )
}

function SimBadge({ label, value }: { label: string; value: number | null }) {
  return (
    <div className={styles.simBadge}>
      <span className={styles.simLabel}>{label}</span>
      <span className={styles.simValue} style={{ color: simColor(value) }}>
        {formatPct(value)}
      </span>
      <span className={styles.simRaw}>{formatSim(value)}</span>
    </div>
  )
}

const INITIAL_CATS = [
  "Charlie Chaplin", "John", "falling rock", "cheese grater", "myself", "dapper handsomely dressed young man"
]

export default function EmbeddingsDebugPage() {
  const [search, setSearch] = useState("person")
  const [description, setDescription] = useState("famous actor and commedian")
  const [tags, setTags] = useState<string[]>(INITIAL_CATS)
  const [searchTask, setSearchTask] = useState(DEFAULT_SEARCH_TASK)
  const [passageTask, setPassageTask] = useState(DEFAULT_PASSAGE_TASK)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DebugResult | null>(null)

  const updateTag = (index: number, value: string) => {
    setTags((prev) => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }

  const handleSearch = async () => {
    if (search.trim() === "") return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch("/api/embeddings/debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ search, description, tags, searchTask, passageTask }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? "Request failed")
        return
      }
      setResult(data as DebugResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error")
    } finally {
      setLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSearch()
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.columns}>
        {/* Left column: search, description, task selectors, button, results */}
        <div className={styles.leftCol}>
          <div className={styles.inputGrid}>
            <div className={styles.inputSection}>
              <Text variant="subheader-2" as="label">Search query</Text>
              <TextInput
                size="xl"
                placeholder='e.g. "person" or "Colorado"'
                value={search}
                onUpdate={setSearch}
                onKeyDown={handleKeyDown}
              />
              {result && (
                <div className={styles.fieldResult}>
                  <EmbeddingPreview values={result.embeddings.search} />
                </div>
              )}
            </div>

            <div className={styles.divider} />

            <div className={styles.inputSection}>
              <Text variant="subheader-2" as="label">Note description</Text>
              <TextInput
                size="l"
                placeholder='e.g. "Famous actor and comedian"'
                value={description}
                onUpdate={setDescription}
                onKeyDown={handleKeyDown}
              />
              {result && (
                <div className={styles.fieldResult}>
                  <EmbeddingPreview values={result.embeddings.description} />
                  <SimBadge label="vs search" value={result.similarities.description} />
                </div>
              )}
            </div>

            <div className={styles.divider} />

            <div className={styles.taskRow}>
              <div className={styles.taskField}>
                <Text variant="body-2" color="secondary" as="label">Search task</Text>
                <Select
                  size="m"
                  options={TASK_OPTIONS}
                  value={[searchTask]}
                  onUpdate={(v) => setSearchTask(v[0] ?? "")}
                  width="max"
                />
              </div>
              <div className={styles.taskField}>
                <Text variant="body-2" color="secondary" as="label">Passage task</Text>
                <Select
                  size="m"
                  options={TASK_OPTIONS}
                  value={[passageTask]}
                  onUpdate={(v) => setPassageTask(v[0] ?? "")}
                  width="max"
                />
              </div>
            </div>
            <Text variant="caption-2" color="secondary">
              Jina <code>task</code> param sent with each embedding request. Defaults match the app: <code>retrieval.query</code> for search, <code>retrieval.passage</code> for stored content.
            </Text>

            <div className={styles.divider} />

            <div className={styles.actions}>
              <Button view="action" size="xl" onClick={() => void handleSearch()} disabled={loading || search.trim() === ""}>
                {loading ? <Loader size="s" /> : "Compare embeddings"}
              </Button>
            </div>
          </div>

          {error && (
            <div className={styles.errorBox}>
              <Text variant="body-1" color="danger">{error}</Text>
            </div>
          )}

          {result && (
            <div className={styles.results}>
              <div className={styles.scoringCard}>
                <Text variant="header-2">Scoring breakdown</Text>
                <Text variant="body-2" color="secondary">
                  Formula: <code>{result.scoring.formula}</code>
                </Text>

                <div className={styles.channelGrid}>
                  <div className={styles.channelRow}>
                    <Text variant="body-1">Description similarity</Text>
                    <span style={{ color: simColor(result.scoring.description) }}>
                      {formatPct(result.scoring.description)}
                    </span>
                  </div>
                  <div className={styles.channelRow}>
                    <Text variant="body-2" color="secondary">Description * 0.67</Text>
                    <span style={{ color: simColor(result.scoring.description * 0.67) }}>
                      {formatPct(result.scoring.description * 0.67)}
                    </span>
                  </div>
                  <div className={styles.channelRow}>
                    <Text variant="body-1">Avg tag similarity</Text>
                    <span style={{ color: simColor(result.scoring.avgTag) }}>
                      {formatPct(result.scoring.avgTag)}
                    </span>
                  </div>
                  <div className={styles.channelRow}>
                    <Text variant="body-2" color="secondary">Avg tag * 0.33</Text>
                    <span style={{ color: simColor(result.scoring.avgTag * 0.33) }}>
                      {formatPct(result.scoring.avgTag * 0.33)}
                    </span>
                  </div>
                </div>

                <div className={styles.divider} />

                <div className={styles.compositeRow}>
                  <Text variant="header-1">Final score</Text>
                  <span className={styles.compositeValue} style={{ color: simColor(result.scoring.compositeScore) }}>
                    {formatPct(result.scoring.compositeScore)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right column: tags */}
        <div className={styles.rightCol}>
          <div className={styles.inputGrid}>
            {tags.map((cat, i) => (
              <div key={i} className={styles.inputSection}>
                <Text variant="body-2" color="secondary" as="label">Tag {i + 1}</Text>
                <TextInput
                  size="l"
                  placeholder={i < 2 ? (i === 0 ? 'e.g. "Charlie Chaplin"' : 'e.g. "Marylin Monroe"') : "(optional)"}
                  value={cat}
                  onUpdate={(v) => updateTag(i, v)}
                  onKeyDown={handleKeyDown}
                />
                {result && (
                  <div className={styles.fieldResult}>
                    <EmbeddingPreview values={result.embeddings.tags[i] ?? []} />
                    <SimBadge label="vs search" value={result.similarities.tags[i] ?? null} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
