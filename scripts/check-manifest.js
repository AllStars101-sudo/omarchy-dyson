#!/usr/bin/env node
const m = require("../manifest.json")
const fs = require("node:fs")
const path = require("node:path")
const root = path.join(__dirname, "..")

let bad = false
const fail = msg => { console.error("FAIL " + msg); bad = true }

for (const k of ["schemaVersion", "id", "name", "version", "kinds", "entryPoints"])
  if (!(k in m)) fail("manifest is missing " + k)
if (m.schemaVersion !== 1) fail("schemaVersion must be 1")
if (String(m.id).startsWith("omarchy.")) fail("id must not use the reserved omarchy. prefix")

for (const [kind, file] of Object.entries(m.entryPoints || {})) {
  const declared = kind === "barWidget" ? "bar-widget" : kind
  if (!(m.kinds || []).includes(declared)) fail(`entryPoint ${kind} has no matching kind`)
  if (!fs.existsSync(path.join(root, file))) fail(`entryPoint ${kind} -> ${file} does not exist`)
}

// A schema key with no default reads as undefined on a fresh install, because
// Omarchy does not merge manifest defaults into widget settings.
const defaults = (m.barWidget || {}).defaults || {}
for (const f of (m.barWidget || {}).schema || [])
  if (!(f.key in defaults)) fail(`schema key ${f.key} has no entry in defaults`)

// The manifest and Config.js both carry defaults; a silent disagreement means
// the settings UI and a fresh config start from different values.
const Config = require("../Config.js")
for (const [key, value] of Object.entries(defaults)) {
  if (key in Config.DEFAULTS && Config.DEFAULTS[key] !== value)
    fail(`default for ${key} disagrees: manifest ${JSON.stringify(value)} vs Config.js ${JSON.stringify(Config.DEFAULTS[key])}`)
}

// The README went stale within one commit last time; a claimed test count that
// nobody checks is worse than no claim.
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8")
const claim = readme.match(/npm test\s+#\s*(\d+) tests/)
if (claim) {
  const { execSync } = require("node:child_process")
  const out = execSync("node --test tests/*.test.js 2>&1 || true",
    { cwd: root, shell: "/bin/bash", encoding: "utf8" })
  const actual = (out.match(/^.*tests (\d+)$/m) || [])[1]
  if (actual && actual !== claim[1])
    fail(`README claims ${claim[1]} tests, the suite has ${actual}`)
}

if (!bad) console.log(`manifest ok: ${m.id} v${m.version}`)
process.exit(bad ? 1 : 0)
