import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'JanExtensionsWeb',
      formats: ['es'],
      fileName: 'index'
    },
    rollupOptions: {
      external: ['@janhq/core', 'zustand', 'react', 'react-dom', 'react/jsx-runtime', '@tabler/icons-react']
    },
    emptyOutDir: false // Don't clean the output directory
  },
  define: {
    JAN_BASE_URL: JSON.stringify(process.env.JAN_BASE_URL || 'https://api-dev.jan.ai/v1'),
    JAN_WEB_EXTENSION_URL: JSON.stringify(process.env.JAN_WEB_EXTENSION_URL || 'http://127.0.0.1:12306/mcp'),
  }
})
