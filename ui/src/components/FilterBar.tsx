import { useState } from 'react'
import type { FilterOptions, FilterPluginMeta, Facets } from '../types'

interface Props {
  filters: FilterOptions
  onChange: (f: FilterOptions) => void
  filterPlugins: FilterPluginMeta[]
  facets: Facets
}

interface MultiInputProps {
  label: string
  placeholder: string
  values: string[]
  onChange: (vals: string[]) => void
}

/**
 * Add-another-input pattern: one editable text input per existing value plus a
 * trailing empty input. Editing a value to empty removes it; committing the
 * trailing input (Enter or blur) appends a new value.
 */
function MultiInput({ label, placeholder, values, onChange }: MultiInputProps) {
  const [draft, setDraft] = useState('')

  const commitDraft = () => {
    const trimmed = draft.trim()
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed])
    }
    setDraft('')
  }

  const editValue = (index: number, raw: string) => {
    const trimmed = raw.trim()
    if (!trimmed) {
      // editing to empty removes it
      onChange(values.filter((_, i) => i !== index))
      return
    }
    if (values.includes(trimmed) && values[index] !== trimmed) {
      // would create a duplicate; drop the edited row
      onChange(values.filter((_, i) => i !== index))
      return
    }
    onChange(values.map((v, i) => (i === index ? trimmed : v)))
  }

  return (
    <div className="filter-group">
      <span className="filter-plugin-label">{label}</span>
      {values.map((v, i) => (
        <div className="multi-input-row" key={`${v}-${i}`}>
          <input
            className="filter-input"
            type="text"
            defaultValue={v}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            onBlur={e => editValue(i, e.target.value)}
          />
          <button
            type="button"
            className="multi-input-remove"
            aria-label={`Remove ${v}`}
            onClick={() => onChange(values.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="multi-input-row">
        <input
          className="filter-input"
          type="text"
          placeholder={placeholder}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitDraft()
            }
          }}
          onBlur={commitDraft}
        />
      </div>
    </div>
  )
}

interface CheckboxGroupProps {
  label: string
  exclude: boolean
  options: string[]
  values: string[]
  onToggle: (v: string, checked: boolean) => void
}

function CheckboxGroup({ label, exclude, options, values, onToggle }: CheckboxGroupProps) {
  return (
    <div className="filter-group">
      <span className="filter-plugin-label">{label}</span>
      {options.length === 0 && (
        <span style={{ fontSize: 11, color: '#4a5568', fontStyle: 'italic' }}>none</span>
      )}
      <div className="checkbox-options">
        {options.map(opt => (
          <label key={opt} className={`checkbox-option${exclude ? ' exclude' : ''}`} title={opt}>
            <input
              type="checkbox"
              checked={values.includes(opt)}
              onChange={e => onToggle(opt, e.target.checked)}
            />
            <span>{opt}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

interface SectionProps {
  title: string
  variant: 'include' | 'exclude'
  plugins: FilterPluginMeta[]
  filters: FilterOptions
  facets: Facets
  update: (key: string, vals: string[]) => void
}

function FilterSection({ title, variant, plugins, filters, facets, update }: SectionProps) {
  const [collapsed, setCollapsed] = useState(false)
  if (plugins.length === 0) return null

  return (
    <div className={`filter-section filter-section-${variant}`}>
      <div
        className="filter-section-header"
        onClick={() => setCollapsed(c => !c)}
        role="button"
        aria-expanded={!collapsed}
      >
        <span className="filter-section-caret">{collapsed ? '▸' : '▾'}</span>
        <span>{title}</span>
      </div>
      {!collapsed && (
        <div className="filter-section-body">
          {plugins.map(p => {
            const exclude = p.mode === 'exclude'
            const current = filters[p.filterKey] ?? []
            const useCheckbox = p.ui.inputType === 'checkbox' && p.facetKey != null

            if (useCheckbox) {
              const options = p.facetKey === 'hosts' ? facets.hosts : facets.contentTypes
              return (
                <CheckboxGroup
                  key={p.id}
                  label={p.ui.label}
                  exclude={exclude}
                  options={options}
                  values={current}
                  onToggle={(v, checked) =>
                    update(p.filterKey, checked ? [...current, v] : current.filter(x => x !== v))
                  }
                />
              )
            }

            return (
              <MultiInput
                key={p.id}
                label={p.ui.label}
                placeholder={p.ui.placeholder}
                values={current}
                onChange={vals => update(p.filterKey, vals)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export function FilterBar({ filters, onChange, filterPlugins, facets }: Props) {
  const update = (key: string, vals: string[]) => {
    onChange({ ...filters, [key]: vals.length ? vals : undefined })
  }

  const includePlugins = filterPlugins.filter(p => p.mode !== 'exclude')
  const excludePlugins = filterPlugins.filter(p => p.mode === 'exclude')

  const activeCount = Object.values(filters).reduce(
    (n, vals) => n + (vals ? vals.length : 0),
    0,
  )

  return (
    <div className="filter-sidebar">
      <div className="filter-sidebar-header">
        <span className="filter-sidebar-title">
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </span>
        <button
          type="button"
          className="filter-clear-all"
          onClick={() => onChange({})}
          disabled={activeCount === 0}
        >
          Clear all
        </button>
      </div>

      <FilterSection
        title="Include"
        variant="include"
        plugins={includePlugins}
        filters={filters}
        facets={facets}
        update={update}
      />
      <FilterSection
        title="Exclude"
        variant="exclude"
        plugins={excludePlugins}
        filters={filters}
        facets={facets}
        update={update}
      />
    </div>
  )
}
