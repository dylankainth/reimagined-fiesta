import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'sodium-universal': 'sodium-javascript'
      ,
      'streamx': 'stream-browserify'
      ,
      'events': 'events',
      'util': 'util/'
      ,
      'process': 'process/browser'
    }
  },
  define: {
    'process.env': {}
  },
  server: {
    port: 3000,
  },
})
