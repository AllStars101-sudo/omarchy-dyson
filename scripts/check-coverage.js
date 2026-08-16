#!/usr/bin/env node
// Fails the build when the logic layer is not fully covered. Reads lcov rather
// than node's table so the threshold is enforced per file: an overall average
// can hide one uncovered module behind several well-covered ones.
const fs = require("node:fs")
const path = require("node:path")

const REQUIRED = { lines: 100, branches: 100, functions: 100 }
// Only files the QML imports as logic. Fixtures are test data, not shipped code.
const TRACKED = ["Dyson.js", "View.js", "Config.js", "Origin.js"]

const text = fs.readFileSync(process.argv[2] || "lcov.info", "utf8")
const files = {}
let current = null
for (const raw of text.split("\n")) {
  const line = raw.trim()
  if (line.startsWith("SF:")) {
    current = path.basename(line.slice(3))
    files[current] = { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 }
  } else if (current) {
    const [key, value] = line.split(":")
    if (files[current][key?.toLowerCase()] !== undefined) {
      files[current][key.toLowerCase()] = Number(value)
    }
  }
}

const pct = (hit, found) => (found === 0 ? 100 : (hit / found) * 100)
let failed = false

for (const name of TRACKED) {
  const f = files[name]
  if (!f) {
    console.error(`FAIL ${name}: not present in the coverage report — is it imported by a test?`)
    failed = true
    continue
  }
  const got = {
    lines: pct(f.lh, f.lf),
    branches: pct(f.brh, f.brf),
    functions: pct(f.fnh, f.fnf)
  }
  const bad = Object.keys(REQUIRED).filter(k => got[k] + 1e-9 < REQUIRED[k])
  const summary = Object.entries(got).map(([k, v]) => `${k} ${v.toFixed(2)}%`).join(", ")
  if (bad.length) {
    console.error(`FAIL ${name}: ${summary} (below threshold on ${bad.join(", ")})`)
    failed = true
  } else {
    console.log(`ok   ${name}: ${summary}`)
  }
}

process.exit(failed ? 1 : 0)
