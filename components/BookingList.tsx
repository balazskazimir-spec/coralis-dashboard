export default function BookingList({ bookings, nights }: any) {
  return (
    <div style={styles.table}>
      <h3 style={{ marginBottom: 20 }}>Bookings</h3>

      {bookings.map((b: any) => (
        <div key={b.id} style={styles.row}>
          <div>
            <div style={{ fontWeight: 600 }}>{b.guest_name}</div>
            <div style={styles.sub}>
              {b.check_in} → {b.check_out}
            </div>
          </div>

          <div style={styles.price}>
            $
            {Math.round(
              nights(b) * (b.price_per_night || 0)
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

const styles = {
  table: {
    padding: 20,
    borderRadius: 20,
    background: 'rgba(17,24,39,0.7)',
  },

  row: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 16,
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },

  sub: {
    opacity: 0.5,
    fontSize: 12,
  },

  price: {
    color: '#8b5cf6',
    fontWeight: 600,
  },
}