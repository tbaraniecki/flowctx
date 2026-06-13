#!/usr/bin/env node
/**
 * Scaffolds a new export or filter plugin in the ./plugins/ directory.
 *
 * Usage:
 *   npx tsx scripts/generate-plugin.ts --type export --name "Postman"
 *   npx tsx scripts/generate-plugin.ts --type filter --name "ContentType" --key contentTypes
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'

function parseArgs(): Record<string, string> {
  const args = process.argv.slice(2)
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length && !args[i + 1].startsWith('--')) {
      result[args[i].slice(2)] = args[i + 1]
      i++
    }
  }
  return result
}

function toKebab(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/\s+/g, '-').toLowerCase()
}

function toCamel(name: string): string {
  return name.replace(/[-\s](.)/g, (_, c) => c.toUpperCase()).replace(/^[A-Z]/, c => c.toLowerCase())
}

function toPascal(name: string): string {
  const camel = toCamel(name)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

function generateExportPlugin(name: string): { filename: string; content: string } {
  const pascal = toPascal(name)
  const kebab = toKebab(name)
  const filename = `export-${kebab}.ts`

  const content = `import type { ExportPlugin, CapturedRequest, FilterOptions } from '../src/plugins/types.js'

export default {
  id: 'export-${kebab}',
  name: '${name}',
  type: 'export' as const,
  fileExtension: 'json',
  mimeType: 'application/json',

  async export(entries: CapturedRequest[], _filters?: FilterOptions): Promise<string> {
    // TODO: transform entries to ${name} format
    // Available fields per entry:
    //   id, timestamp, method, host, path, url, httpVersion
    //   requestHeaders, requestBody
    //   statusCode, statusText, responseHeaders, responseBody
    //   timings: { send, wait, receive, total } (all in ms)

    const output = entries.map(req => ({
      method: req.method,
      url: req.url,
      status: req.statusCode,
      durationMs: req.timings.total,
      // add your fields here
    }))

    return JSON.stringify(output, null, 2)
  },
} satisfies ExportPlugin
`

  return { filename, content }
}

function generateFilterPlugin(name: string, filterKey: string): { filename: string; content: string } {
  const kebab = toKebab(name)
  const filename = `filter-${kebab}.ts`

  const content = `import type { FilterPlugin, CapturedRequest } from '../src/plugins/types.js'

export default {
  id: 'filter-${kebab}',
  name: '${name}',
  type: 'filter' as const,
  filterKey: '${filterKey}',

  match(req: CapturedRequest, values: string[]): boolean {
    // Called with each request and the current filter values (from UI tag input).
    // Return true if the request should be INCLUDED in results.
    // values is never empty when this is called.
    //
    // Example — match by status code:
    //   return values.includes(String(req.statusCode))
    //
    // Available request fields:
    //   id, timestamp, method, host, path, url, httpVersion
    //   requestHeaders, requestBody
    //   statusCode, statusText, responseHeaders, responseBody
    //   timings: { send, wait, receive, total }

    return true // TODO: implement match logic
  },

  ui: {
    label: '${name}',
    placeholder: 'value1, value2...',
  },
} satisfies FilterPlugin
`

  return { filename, content }
}

function main() {
  const args = parseArgs()

  const type = args['type']
  const name = args['name']

  if (!type || !name) {
    console.error('Usage:')
    console.error('  npx tsx scripts/generate-plugin.ts --type export --name "MyFormat"')
    console.error('  npx tsx scripts/generate-plugin.ts --type filter --name "StatusCode" --key statusCodes')
    process.exit(1)
  }

  if (type !== 'export' && type !== 'filter') {
    console.error(`--type must be "export" or "filter", got: ${type}`)
    process.exit(1)
  }

  const pluginsDir = path.resolve(process.cwd(), 'plugins')
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true })
    console.log('Created ./plugins/ directory')
  }

  let filename: string
  let content: string

  if (type === 'export') {
    ;({ filename, content } = generateExportPlugin(name))
  } else {
    const filterKey = args['key'] ?? toCamel(name) + 's'
    ;({ filename, content } = generateFilterPlugin(name, filterKey))
  }

  const outPath = path.join(pluginsDir, filename)

  if (existsSync(outPath)) {
    console.error(`File already exists: plugins/${filename}`)
    console.error('Delete it first or choose a different name.')
    process.exit(1)
  }

  writeFileSync(outPath, content, 'utf8')

  console.log(`\nCreated plugins/${filename}`)
  console.log('\nNext steps:')
  if (type === 'export') {
    console.log(`  1. Edit plugins/${filename} — implement the export() method`)
    console.log('  2. Restart the server (make record)')
    console.log(`  3. Plugin "${name}" will appear in the Export dropdown automatically`)
  } else {
    console.log(`  1. Edit plugins/${filename} — implement the match() method`)
    console.log('  2. Restart the server (make record)')
    console.log(`  3. Filter "${name}" will appear in the FilterBar automatically`)
  }
}

main()
