import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

interface Migration {
  version: number
  name: string
  sql: string
}

function loadMigrations(): Migration[] {
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'))
  const migrations: Migration[] = files.map(file => {
    const match = file.match(/^(\d+)_/)
    if (!match) {
      throw new Error(`Migration file "${file}" must start with a numeric prefix (e.g. 001_init.sql)`)
    }
    return {
      version: Number(match[1]),
      name: file,
      sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
    }
  })
  migrations.sort((a, b) => a.version - b.version)
  return migrations
}

/**
 * Applies pending numbered migrations in ascending order, each inside a
 * transaction, bumping PRAGMA user_version after each. Idempotent: migrations
 * whose number <= current user_version are skipped.
 */
export function migrate(db: Database.Database): void {
  const current = (db.pragma('user_version', { simple: true }) as number) ?? 0

  for (const migration of loadMigrations()) {
    if (migration.version <= current) continue

    const apply = db.transaction(() => {
      db.exec(migration.sql)
      db.pragma(`user_version = ${migration.version}`)
    })
    apply()
  }
}
