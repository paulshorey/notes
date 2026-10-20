import { Pool } from "pg"

type ItemsDatabaseGlobal = typeof globalThis & {
  __itemsDatabasePool?: Pool
}

const databaseGlobal = globalThis as ItemsDatabaseGlobal
const DEFAULT_POOL_MAX = 1
const DEFAULT_IDLE_TIMEOUT_MS = 0

export const getDb = () => {
  if (!databaseGlobal.__itemsDatabasePool) {
    const connectionString = process.env.DB_ITEMS_URL ?? process.env.DB_NOTES_URL
    if (!connectionString) {
      throw new Error("DB_ITEMS_URL environment variable not set (DB_NOTES_URL remains supported)")
    }

    databaseGlobal.__itemsDatabasePool = new Pool({
      connectionString,
      // Keep one pool for the whole Next.js process, including development
      // route bundles and hot reloads. The Railway public proxy can time out
      // when a cold bootstrap opens several connections at once, so serialize
      // the app's short queries by default. Deployments that need more
      // concurrency can opt in with PG_POOL_MAX.
      max: Number(process.env.PG_POOL_MAX || DEFAULT_POOL_MAX),
      // Keep the one established proxy connection available between bursts.
      // Reopening it after every short idle period recreates the same cold
      // connection failure this pool is intended to avoid.
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || DEFAULT_IDLE_TIMEOUT_MS),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10_000),
      keepAlive: true,
      keepAliveInitialDelayMillis: Number(process.env.PG_KEEPALIVE_INITIAL_DELAY_MS || 10_000),
    })

    // Prevent idle-client pool errors from crashing the process.
    databaseGlobal.__itemsDatabasePool.on("error", (err) => {
      console.error("Postgres pool idle client error:", err)
    })
  }

  return databaseGlobal.__itemsDatabasePool
}
