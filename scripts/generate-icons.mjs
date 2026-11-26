import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const svgPath = path.join(root, 'public', 'favicon.svg')
const buildDir = path.join(root, 'build')

function buildIcoFromPngs(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = header.length + dir.length
  entries.forEach(({ size, buffer }, idx) => {
    const pos = idx * 16
    dir.writeUInt8(size >= 256 ? 0 : size, pos + 0)
    dir.writeUInt8(size >= 256 ? 0 : size, pos + 1)
    dir.writeUInt8(0, pos + 2)
    dir.writeUInt8(0, pos + 3)
    dir.writeUInt16LE(1, pos + 4)
    dir.writeUInt16LE(32, pos + 6)
    dir.writeUInt32LE(buffer.length, pos + 8)
    dir.writeUInt32LE(offset, pos + 12)
    offset += buffer.length
  })

  return Buffer.concat([header, dir, ...entries.map(e => e.buffer)])
}

async function main() {
  if (!fs.existsSync(svgPath)) {
    throw new Error(`找不到源图标：${svgPath}`)
  }
  fs.mkdirSync(buildDir, { recursive: true })
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polaris-icons-'))
  try {
    const masterPng = path.join(buildDir, 'icon.png')
    execFileSync('rsvg-convert', ['-w', '1024', '-h', '1024', svgPath, '-o', masterPng], { stdio: 'inherit' })

    const icoSizes = [16, 24, 32, 48, 64, 128, 256]
    const icoEntries = icoSizes.map(size => {
      const out = path.join(tmpDir, `ico-${size}.png`)
      execFileSync('sips', ['-z', String(size), String(size), masterPng, '--out', out], { stdio: 'pipe' })
      return { size, buffer: fs.readFileSync(out) }
    })
    fs.writeFileSync(path.join(buildDir, 'icon.ico'), buildIcoFromPngs(icoEntries))

    const iconsetDir = path.join(tmpDir, 'Polaris.iconset')
    fs.mkdirSync(iconsetDir, { recursive: true })
    const pairs = [
      [16, 'icon_16x16.png'],
      [32, 'icon_16x16@2x.png'],
      [32, 'icon_32x32.png'],
      [64, 'icon_32x32@2x.png'],
      [128, 'icon_128x128.png'],
      [256, 'icon_128x128@2x.png'],
      [256, 'icon_256x256.png'],
      [512, 'icon_256x256@2x.png'],
      [512, 'icon_512x512.png'],
      [1024, 'icon_512x512@2x.png'],
    ]
    for (const [size, filename] of pairs) {
      execFileSync('sips', ['-z', String(size), String(size), masterPng, '--out', path.join(iconsetDir, filename)], { stdio: 'pipe' })
    }
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(buildDir, 'icon.icns')], { stdio: 'inherit' })
    console.log('Generated build/icon.png, build/icon.icns, build/icon.ico')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

await main()
