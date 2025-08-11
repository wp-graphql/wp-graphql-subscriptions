import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/graphql/stream': {
        target: 'http://wpgraphql.local',
        changeOrigin: true,
        ws: false // Disable WebSocket proxying since we use SSE
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
})