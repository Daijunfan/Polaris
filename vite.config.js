import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'vendor-markdown', test: /node_modules[\\/](react-markdown|remark-|unified|micromark|mdast|unist|vfile|hast|property-information|devlop|bail|trough|is-plain-obj)/ },
            { name: 'vendor-icons', test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    open: false,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.local/**', '**/*.xlsx', '**/*.zip', '**/data/dataset.json', '**/src/data/admissionData.js', '**/初试结果.md', '**/复试结果.md'] },
  },
})
