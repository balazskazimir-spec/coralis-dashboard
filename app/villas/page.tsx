'use client'

import { useSearchParams } from 'next/navigation'

export default function VillasPage() {
  const params = useSearchParams()
  const villa = params.get('villa') || '1'

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>Villa {villa}</h1>

      <div style={styles.card}>
        <p>Villa {villa} dashboard</p>
      </div>
    </div>
  )
}

const styles = {
  page: {
    padding: 40,
    color: 'white',
  },

  title: {
    fontSize: 28,
    marginBottom: 20,
  },

  card: {
    padding: 20,
    borderRadius: 16,
    background: 'rgba(17,24,39,0.7)',
  },
}