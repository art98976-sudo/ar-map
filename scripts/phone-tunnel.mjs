// `npm run dev:phone`: starts the dev server and a free HTTPS tunnel (Cloudflare),
// then prints a QR code. Scan it with your iPhone camera to test with live reload.
// The camera only works over https://, which is why a tunnel is needed.
import {spawn} from 'node:child_process'
import qrcode from 'qrcode-terminal'

const PORT = 5173
const isWin = process.platform === 'win32'

const vite = spawn(isWin ? 'npx.cmd' : 'npx', ['vite', '--port', String(PORT), '--strictPort'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  shell: isWin,
})

const tunnel = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
})

tunnel.on('error', () => {
  console.error('\n  cloudflared is not installed. Install it with:  winget install Cloudflare.cloudflared\n')
  shutdown(1)
})

let shown = false
const onOutput = (chunk) => {
  const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
  if (match && !shown) {
    shown = true
    console.log('\n  Phone test link (HTTPS):', match[0], '\n')
    qrcode.generate(match[0], {small: true})
    console.log('\n  Scan the QR code with your iPhone camera. Press Ctrl+C to stop.\n')
  }
}
tunnel.stdout.on('data', onOutput)
tunnel.stderr.on('data', onOutput)

function shutdown(code = 0) {
  vite.kill()
  tunnel.kill()
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
vite.on('exit', (code) => shutdown(code ?? 0))
