import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * ビルドで出力したファイル（ハッシュ付きの JS/CSS）の一覧と、ビルドごとの ID を dist/sw.js に書き込む。
 * これで Service Worker が初回訪問時にアプリ一式を保存でき、新しい版を出すと古い保存分が消える。
 */
function swPrecache(): Plugin {
  let outDir = 'dist'
  let files: string[] = []
  return {
    name: 'taite-sw-precache',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    generateBundle(_options, bundle) {
      files = Object.keys(bundle).filter((f) => f !== 'index.html')
    },
    closeBundle() {
      const path = resolve(outDir, 'sw.js')
      const src = readFileSync(path, 'utf8')
      const out = src
        .replace('const PRECACHE = self.__PRECACHE__', `const PRECACHE = ${JSON.stringify(files.map((f) => './' + f))}`)
        .replace("const CACHE = 'taite-__BUILD_ID__'", `const CACHE = 'taite-${Date.now().toString(36)}'`)
      if (out.includes('__PRECACHE__') || out.includes('__BUILD_ID__')) {
        throw new Error('sw.js の置き換え対象が見つかりません')
      }
      writeFileSync(path, out)
    },
  }
}

// base: './' で GitHub Pages / Cloudflare Pages どちらのサブパスでも動く
export default defineConfig({ base: './', plugins: [swPrecache()] })
