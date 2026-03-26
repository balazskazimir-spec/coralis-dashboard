'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

type ExpenseFormProps = {
  onAdded: () => void
}

export default function ExpenseForm({ onAdded }: ExpenseFormProps) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState('')
  const [category, setCategory] = useState('cleaning')
  const [note, setNote] = useState('')
  const [villa, setVilla] = useState('villa-1')

  async function addExpense() {
    if (!amount || !date) {
      alert('missing data')
      return
    }

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

    onAdded()
  }

  return (
    <div style={styles.box}>
      <h3>Add Expense</h3>

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
        <option value="villa-1">Villa Serra</option>
        <option value="villa-2">Villa Mira</option>
      </select>

      <input
        placeholder="Note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={styles.input}
      />

      <button onClick={addExpense} style={styles.button}>
        Add
      </button>
    </div>
  )
}

const styles = {
  box: {
    padding: 20,
    borderRadius: 16,
    background: 'rgba(17,24,39,0.7)',
    marginBottom: 20,
  },
  input: {
    width: '100%',
    marginBottom: 10,
    padding: 10,
    borderRadius: 8,
    background: '#111827',
    color: 'white',
    border: '1px solid #333',
  },
  button: {
    padding: 10,
    borderRadius: 8,
    background: '#8b5cf6',
    border: 'none',
    color: 'white',
    cursor: 'pointer',
  },
}
