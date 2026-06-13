import type { Plugin, ExportPlugin, FilterPlugin } from '../types.js'
import { HarExportPlugin } from './builtin/har.js'
import { JsonExportPlugin } from './builtin/json.js'
import { CsvExportPlugin } from './builtin/csv.js'
import { DomainFilterPlugin } from './builtin/filters/domain.js'
import { PathFilterPlugin } from './builtin/filters/path.js'
import { ExtensionFilterPlugin } from './builtin/filters/extension.js'
import { ExcludePathFilterPlugin } from './builtin/filters/exclude-path.js'
import { ExcludeContentTypeFilterPlugin } from './builtin/filters/exclude-content-type.js'
import { readdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'

class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map()

  register(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin)
  }

  getExportPlugins(): ExportPlugin[] {
    return [...this.plugins.values()].filter((p): p is ExportPlugin => p.type === 'export')
  }

  getFilterPlugins(): FilterPlugin[] {
    return [...this.plugins.values()].filter((p): p is FilterPlugin => p.type === 'filter')
  }

  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id)
  }

  // Returns metadata safe to send to browser
  getMetadata() {
    return {
      exports: this.getExportPlugins().map(p => ({ id: p.id, name: p.name, fileExtension: p.fileExtension })),
      filters: this.getFilterPlugins().map(p => ({
        id: p.id,
        name: p.name,
        filterKey: p.filterKey,
        mode: p.mode ?? 'include',
        facetKey: p.facetKey,
        ui: { label: p.ui.label, placeholder: p.ui.placeholder, inputType: p.ui.inputType ?? 'tags' },
      })),
    }
  }
}

export const registry = new PluginRegistry()

export async function loadPlugins(): Promise<void> {
  // register built-ins
  registry.register(new HarExportPlugin())
  registry.register(new JsonExportPlugin())
  registry.register(new CsvExportPlugin())
  registry.register(new DomainFilterPlugin())
  registry.register(new PathFilterPlugin())
  registry.register(new ExtensionFilterPlugin())
  registry.register(new ExcludePathFilterPlugin())
  registry.register(new ExcludeContentTypeFilterPlugin())

  // load user plugins from ./plugins/ dir
  const pluginsDir = path.resolve(process.cwd(), 'plugins')
  if (existsSync(pluginsDir)) {
    const files = await readdir(pluginsDir)
    for (const file of files.filter(f => f.endsWith('.js') || f.endsWith('.ts'))) {
      try {
        const mod = await import(path.join(pluginsDir, file))
        if (mod.default) registry.register(mod.default)
      } catch (e) {
        console.warn(`Failed to load plugin ${file}:`, e)
      }
    }
  }
}
