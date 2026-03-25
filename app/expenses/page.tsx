'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<any[]>([])

  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [category, setCategory] = useState('cleaning')
  const [note, setNote] = useState('')
  const [villa, setVilla] = useState('villa-1')

  useEffect(() => {
    fetchExpenses()
  }, [])

  async function fetchExpenses() {
    const { data } = await supabase
      .from('expenses')
      .select('*')
      .order('date', { ascending: false })

    setExpenses(data || [])
  }

  async function addExpense() {
    if (!amount || !date) return

    await supabase.from('expenses').insert([
      {
        amount: Number(amount),
        date,
        category,
        note,
        villa_id: villa,
      },
    ])

    setAmount('')
    setDate('')
    setNote('')
    fetchExpenses()
  }

  async function remove(id: string) {
    await supabase.from('expenses').delete().eq('id', id)
    fetchExpenses()
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Expenses</h1>

      {/* FORM */}
      <div style={styles.form}>
        <input
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={styles.input}
        />

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={styles.input}
        />

        <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.input}>
          <option value="cleaning">Cleaning</option>
          <option value="utilities">Utilities</option>
          <option value="maintenance">Maintenance</option>
        </select>

        <select value={villa} onChange={(e) => setVilla(e.target.value)} style={styles.input}>
          <option value="villa-1">Villa 1</option>
          <option value="villa-2">Villa 2</option>
        </select>

        <input
          placeholder="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={styles.input}
        />

        <button onClick={addExpense} style={styles.button}>
          Add Expense
        </button>
      </div>

      {/* LIST */}
      <div style={styles.list}>
        {expenses.map((e) => (
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
    </div>
  )
}

/* ---------- STYLES ---------- */

const styles = {
  page: {
    padding: 40,
    color: 'white',
  },

  title: {
    fontSize: 28,
    marginBottom: 20,
  },

  form: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6,1fr)',
    gap: 10,
    marginBottom: 30,
  },

  input: {
    padding: 10,
    borderRadius: 8,
    background: '#111827',
    border: '1px solid #333',
    color: 'white',
  },

  button: {
    background: '#8b5cf6',
    border: 'none',
    borderRadius: 8,
    color: 'white',
    cursor: 'pointer',
  },

  list: {
    background: 'rgba(17,24,39,0.7)',
    borderRadius: 16,
    padding: 20,
  },

  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 12,
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
    padding: '4px 8px',
    cursor: 'pointer',
  },
}