import { describe, expect, it, vi } from 'vitest'
import {
  loadActiveVisitorCart,
  replaceVisitorCart,
  convertVisitorCart,
} from './visitor-cart'

type Row = Record<string, unknown>

function makeAdmin(initial: {
  carts?: Row[]
  cart_items?: Row[]
  business_items?: Row[]
  messenger_threads?: Row[]
} = {}) {
  const tables: Record<string, Row[]> = {
    carts: [...(initial.carts ?? [])],
    cart_items: [...(initial.cart_items ?? [])],
    business_items: [...(initial.business_items ?? [])],
    messenger_threads: [...(initial.messenger_threads ?? [])],
  }

  function builder(name: string) {
    const filters: { col: string; op: string; val: unknown }[] = []
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row | Row[] | null = null

    const api: any = {
      select(_cols: string) { return api },
      eq(col: string, val: unknown) { filters.push({ col, op: 'eq', val }); return api },
      in(col: string, vals: unknown[]) { filters.push({ col, op: 'in', val: vals }); return api },
      insert(rows: Row | Row[]) { mode = 'insert'; payload = rows; return api },
      update(row: Row) { mode = 'update'; payload = row; return api },
      delete() { mode = 'delete'; return api },
      maybeSingle() { return apply().then((rows) => ({ data: rows[0] ?? null, error: null })) },
      single() { return apply().then((rows) => ({ data: rows[0] ?? null, error: null })) },
      then(resolve: (v: unknown) => void) { return apply().then((rows) => resolve({ data: rows, error: null })) },
    }

    async function apply(): Promise<Row[]> {
      const matches = (row: Row) =>
        filters.every((f) =>
          f.op === 'eq'
            ? row[f.col] === f.val
            : Array.isArray(f.val) && (f.val as unknown[]).includes(row[f.col]),
        )

      if (mode === 'select') return tables[name].filter(matches)

      if (mode === 'insert') {
        const rows = Array.isArray(payload) ? payload : [payload as Row]
        const stamped = rows.map((r, i) => ({ id: r.id ?? `gen-${tables[name].length + i + 1}`, ...r }))
        tables[name].push(...stamped)
        return stamped
      }

      if (mode === 'update') {
        const updated: Row[] = []
        for (const row of tables[name]) {
          if (matches(row)) { Object.assign(row, payload as Row); updated.push(row) }
        }
        return updated
      }

      // delete
      const before = tables[name].length
      tables[name] = tables[name].filter((r) => !matches(r))
      return Array.from({ length: before - tables[name].length }, () => ({}))
    }

    return api
  }

  return { from: vi.fn((name: string) => builder(name)), _tables: tables }
}

const baseCtx = {
  actionPageId: 'page-1',
  psid: 'PSID_A',
  pageOwnerId: 'owner-1',
  fbPageId: 'fb-1',
}

describe('visitor-cart helpers', () => {
  it('loadActiveVisitorCart returns empty when no cart exists', async () => {
    const admin = makeAdmin()
    const cart = await loadActiveVisitorCart(admin as any, baseCtx)
    expect(cart).toEqual({ items: [] })
  })

  it('loadActiveVisitorCart returns items for the active cart', async () => {
    const admin = makeAdmin({
      carts: [{ id: 'c1', action_page_id: 'page-1', psid: 'PSID_A', status: 'active', user_id: 'owner-1' }],
      cart_items: [
        { id: 'i1', cart_id: 'c1', product_id: 'prod-1', quantity: 2 },
        { id: 'i2', cart_id: 'c1', product_id: 'prod-2', quantity: 1 },
      ],
    })
    const cart = await loadActiveVisitorCart(admin as any, baseCtx)
    expect(cart.items).toEqual([
      { id: 'prod-1', quantity: 2 },
      { id: 'prod-2', quantity: 1 },
    ])
  })

  it('replaceVisitorCart creates a new active cart on first call', async () => {
    const admin = makeAdmin({
      business_items: [
        { id: 'prod-1', user_id: 'owner-1', status: 'published', title: 'Mug', price_amount: 10, currency: 'USD', cover_image_url: null },
      ],
    })
    await replaceVisitorCart(admin as any, baseCtx, [{ id: 'prod-1', quantity: 3 }])
    expect((admin as any)._tables.carts).toHaveLength(1)
    expect((admin as any)._tables.cart_items).toHaveLength(1)
    expect((admin as any)._tables.cart_items[0]).toMatchObject({
      product_id: 'prod-1', quantity: 3, unit_price: 10, name: 'Mug',
    })
  })

  it('replaceVisitorCart drops unknown product ids', async () => {
    const admin = makeAdmin({
      business_items: [
        { id: 'prod-1', user_id: 'owner-1', status: 'published', title: 'Mug', price_amount: 10, currency: 'USD', cover_image_url: null },
      ],
    })
    await replaceVisitorCart(admin as any, baseCtx, [
      { id: 'prod-1', quantity: 1 },
      { id: 'prod-bad', quantity: 9 },
    ])
    const items = (admin as any)._tables.cart_items
    expect(items).toHaveLength(1)
    expect(items[0].product_id).toBe('prod-1')
  })

  it('replaceVisitorCart with empty array clears items but keeps cart row', async () => {
    const admin = makeAdmin({
      carts: [{ id: 'c1', action_page_id: 'page-1', psid: 'PSID_A', status: 'active', user_id: 'owner-1', total_amount: 20, currency: 'USD' }],
      cart_items: [{ id: 'i1', cart_id: 'c1', product_id: 'prod-1', quantity: 2, unit_price: 10, name: 'Mug' }],
      business_items: [],
    })
    await replaceVisitorCart(admin as any, baseCtx, [])
    expect((admin as any)._tables.carts).toHaveLength(1)
    expect((admin as any)._tables.cart_items).toHaveLength(0)
    expect((admin as any)._tables.carts[0].total_amount).toBeNull()
  })

  it('convertVisitorCart marks active cart converted', async () => {
    const admin = makeAdmin({
      carts: [{ id: 'c1', action_page_id: 'page-1', psid: 'PSID_A', status: 'active', user_id: 'owner-1' }],
    })
    await convertVisitorCart(admin as any, baseCtx)
    expect((admin as any)._tables.carts[0].status).toBe('converted')
    expect((admin as any)._tables.carts[0].converted_at).toBeTruthy()
  })

  it('convertVisitorCart no-ops when there is no active cart', async () => {
    const admin = makeAdmin()
    await expect(convertVisitorCart(admin as any, baseCtx)).resolves.toBeUndefined()
  })
})
