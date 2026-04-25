import path from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  publicDir: path.resolve(dirname, '../public'),
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
