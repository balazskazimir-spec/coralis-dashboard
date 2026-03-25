'use client'

import { supabase } from '@/lib/supabase'

export default function ExpenseList({ expenses, refresh }: any) {
  async function remove(id: string) {
    await supabase.from('expenses').delete().eq('id', id)
    refresh()
  }

  return (
    <div style={styles.box}>
      <h3>Expenses</h3>

      {expenses.map((e: any) => (
        <div key={e.id} style={styles.row}>
          <div>
            <div>{e.category}</div>
            <div style={styles.sub}>
              {e.date} • {e.note}
            </div>
          </div>

          <div style={styles.right}>
            <span>${e.amount}</span>
            <button onClick={() => remove(e.id)} style={styles.delete}>
              x
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

const styles = {
  box: {
    padding: 20,
    borderRadius: 16,
    background: 'rgba(17,24,39,0.7)',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 10,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  sub: {
    opacity: 0.5,
    fontSize: 12,
  },
  right: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  delete: {
    background: 'red',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
    padding: '4px 8px',
  },
}