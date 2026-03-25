import Sidebar from '../components/Sidebar'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body style={styles.page}>
        <Sidebar />

        <div style={styles.main}>
          {children}
        </div>
      </body>
    </html>
  )
}

const styles = {
  page: {
    display: 'flex',
    minHeight: '100vh',
    background: '#020617',
    color: 'white',
    fontFamily: 'sans-serif',
  },

  main: {
    flex: 1,
    padding: 30,
  },
}