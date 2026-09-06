import type { SupabaseClient } from '@supabase/supabase-js'

// Minimal in-memory stand-in for the three OAuth tables, enough to drive the
// token endpoint and stores end to end in unit tests. Supports the subset of
// the PostgREST builder the OAuth code uses: insert, select+eq+maybeSingle,
// update+eq(+is), delete+eq+select+maybeSingle.
type Row = Record<string, unknown>

export function createFakeAdmin(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
  )
  const table = (name: string): Row[] => (tables[name] ??= [])

  function builder(name: string) {
    const filters: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'update' | 'delete' | 'insert' = 'select'
    let patch: Row = {}
    const matches = (r: Row) => filters.every((f) => f(r))

    const run = () => {
      const rows = table(name)
      if (mode === 'update') {
        rows.forEach((r, i) => { if (matches(r)) rows[i] = { ...r, ...patch } })
        return { data: null, error: null }
      }
      if (mode === 'delete') {
        const removed = rows.filter(matches)
        tables[name] = rows.filter((r) => !matches(r))
        return { data: removed, error: null }
      }
      return { data: rows.filter(matches), error: null }
    }

    const api = {
      select() { if (mode === 'select') mode = 'select'; return api },
      insert(row: Row | Row[]) {
        mode = 'insert'
        for (const r of Array.isArray(row) ? row : [row]) {
          table(name).push({ id: r.id ?? `row-${table(name).length + 1}`, ...r })
        }
        return { error: null, then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res) }
      },
      update(p: Row) { mode = 'update'; patch = p; return api },
      delete() { mode = 'delete'; return api },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return api },
      is(col: string, val: unknown) { filters.push((r) => r[col] === val); return api },
      gt(col: string, val: string) { filters.push((r) => String(r[col]) > val); return api },
      order() { return api },
      async maybeSingle() {
        const { data } = run()
        return { data: (data ?? [])[0] ?? null, error: null }
      },
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(run()).then(res, rej)
      },
    }
    return api
  }

  return {
    tables,
    admin: { from: (name: string) => builder(name) } as unknown as SupabaseClient,
  }
}
