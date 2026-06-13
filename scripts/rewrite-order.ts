#!/usr/bin/env node
/**
 * Rewrite requests.order_id so it is a 1-based, per-recording sequence ordered by
 * request *start time* (the `timestamp` column).
 *
 * Why: order_id used to be assigned at insert, which is response-completion order.
 * A request that started first but responded slowly ended up with a higher
 * order_id than a later-but-faster one. Live capture now numbers by start order;
 * this script fixes historical rows (and can be re-run any time to renormalise).
 *
 * Ties on the millisecond-resolution timestamp are broken deterministically by
 * the existing order_id then the row id, so repeated runs are stable.
 *
 * Usage:
 *   npx tsx scripts/rewrite-order.ts            # rewrites requests.db (or $DB_PATH)
 *   npx tsx scripts/rewrite-order.ts --db foo.db
 *   npx tsx scripts/rewrite-order.ts --dry-run  # report changes, write nothing
 */

import Database from 'better-sqlite3'

function parseArgs(): { db: string; dryRun: boolean } {
  const args = process.argv.slice(2)
  let db = process.env.DB_PATH ?? 'requests.db'
  let dryRun = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      db = args[i + 1]
      i++
    } else if (args[i] === '--dry-run') {
      dryRun = true
    }
  }
  return { db, dryRun }
}

function main(): void {
  const { db: dbPath, dryRun } = parseArgs()
  const db = new Database(dbPath)

  // NULL recording_id (legacy/untagged rows) forms its own partition.
  const ranked = db
    .prepare(
      `SELECT id, recording_id, order_id AS old_order,
              ROW_NUMBER() OVER (
                PARTITION BY recording_id
                ORDER BY timestamp ASC, order_id ASC, id ASC
              ) AS new_order
       FROM requests`
    )
    .all() as { id: string; recording_id: string | null; old_order: number | null; new_order: number }[]

  const changed = ranked.filter(r => r.old_order !== r.new_order)
  const perRecording = new Map<string, number>()
  for (const r of ranked) {
    const key = r.recording_id ?? '(none)'
    perRecording.set(key, (perRecording.get(key) ?? 0) + 1)
  }

  console.log(`DB: ${dbPath}`)
  console.log(`Recordings: ${perRecording.size}, requests: ${ranked.length}`)
  for (const [rec, count] of perRecording) {
    console.log(`  ${rec}: ${count} requests`)
  }
  console.log(`Rows needing renumber: ${changed.length}`)

  if (dryRun) {
    console.log('Dry run — no changes written.')
    db.close()
    return
  }

  // Apply in one transaction. Use a temp value offset trick is unnecessary here:
  // order_id has no UNIQUE constraint, so direct per-row updates are safe.
  const update = db.prepare('UPDATE requests SET order_id = ? WHERE id = ?')
  const apply = db.transaction((rows: typeof changed) => {
    for (const r of rows) update.run(r.new_order, r.id)
  })
  apply(changed)

  console.log(`Rewrote order_id for ${changed.length} rows.`)
  db.close()
}

main()
