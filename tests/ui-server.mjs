import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createApplication } from '../server/index.mjs'
import { createStore } from '../server/store.js'
import { createConfig } from '../server/config.js'
import { startMockProvider } from './mock-provider.mjs'

const provider = await startMockProvider(), dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mentor-ui-'))
const store = createStore(dir), config = createConfig(store, { MENTOR_API_URL: provider.url, MENTOR_API_KEY: 'ui-fixture-only', MENTOR_MODEL: 'test-agent' })
store.write('membership',{tier:'ssvip',owner:true,experienceTier:null})
const app = createApplication({ store, config, staticDirectory: process.env.MENTOR_TEST_FRONTEND||path.resolve('.local/ui-test-dist') }), server = http.createServer(app.handler)
server.listen(3321, '127.0.0.1', () => console.log('UI test server ready'))
async function close() { await app.cancelAll(); server.closeAllConnections(); await provider.close(); await fs.rm(dir, { recursive: true, force: true }); process.exit(0) }
process.on('SIGINT', close); process.on('SIGTERM', close)
