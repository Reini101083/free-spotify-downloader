import { defineConfig } from 'vite'
export default defineConfig({ root: 'web', server: { watch: { usePolling: true, interval: 500 }, host: '0.0.0.0', allowedHosts: ['terminal.local'] } })
