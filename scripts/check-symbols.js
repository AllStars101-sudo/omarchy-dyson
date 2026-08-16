#!/usr/bin/env node
// Verify every Module.symbol referenced from QML actually exists in the JS file
// that QML imports. node --check is per-file and tests never load the QML, so
// this class of break is otherwise invisible until runtime.
const fs = require("node:fs")
const path = require("node:path")
const root = path.join(__dirname, "..")

let bad = false
for (const file of fs.readdirSync(root).filter(f => f.endsWith(".qml"))) {
  const src = fs.readFileSync(path.join(root, file), "utf8")
  const imports = [...src.matchAll(/import\s+"([\w.]+\.js)"\s+as\s+(\w+)/g)]
  for (const [, jsFile, alias] of imports) {
    let mod
    try {
      mod = require(path.join(root, jsFile))
    } catch (e) {
      console.error(`FAIL ${file}: cannot load ${jsFile} — ${e.message}`)
      bad = true
      continue
    }
    // Scan the body only: the import line itself reads as Alias.js otherwise.
    const body = src.replace(/^\s*import\s+.*$/gm, "")
    const used = new Set([...body.matchAll(new RegExp(`\\b${alias}\\.(\\w+)`, "g"))].map(m => m[1]))
    for (const symbol of used) {
      if (!(symbol in mod)) {
        console.error(`FAIL ${file}: ${alias}.${symbol}() does not exist in ${jsFile}`)
        bad = true
      }
    }
  }
}
if (!bad) console.log("cross-file symbols ok")
process.exit(bad ? 1 : 0)
