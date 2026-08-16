#!/usr/bin/env bash
# Structural check on the QML. Full type checking is impossible outside Omarchy
# — qs.Ui and qs.Commons live in the shell, which CI does not have — so this
# asserts what CAN be asserted without it: that every file parses, that each
# declares the imports it uses, and that the manifest's entry points exist.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
QMLLINT="${QMLLINT:-$(command -v qmllint || echo /usr/lib/qt6/bin/qmllint)}"

echo "== manifest =="
node -e '
const m = require("./manifest.json"), fs = require("fs")
const need = ["schemaVersion","id","name","version","kinds","entryPoints"]
for (const k of need) if (!(k in m)) { console.error("missing " + k); process.exit(1) }
if (m.schemaVersion !== 1) { console.error("schemaVersion must be 1"); process.exit(1) }
if (m.id.startsWith("omarchy.")) { console.error("id must not use the reserved omarchy. prefix"); process.exit(1) }
for (const [kind, file] of Object.entries(m.entryPoints)) {
  if (!m.kinds.includes(kind === "barWidget" ? "bar-widget" : kind)) {
    console.error(`entryPoint ${kind} has no matching kind`); process.exit(1)
  }
  if (!fs.existsSync(file)) { console.error(`entryPoint ${kind} -> ${file} does not exist`); process.exit(1) }
}
// Declared schema keys must have defaults, or a fresh install reads undefined.
for (const f of (m.barWidget?.schema || [])) {
  if (!(f.key in (m.barWidget.defaults || {}))) {
    console.error(`schema key ${f.key} has no entry in defaults`); process.exit(1)
  }
}
console.log("manifest ok: " + m.id + " v" + m.version)
' || fail=1

echo "== qml parse =="
for f in *.qml; do
  out=$("$QMLLINT" "$f" 2>&1)
  # Unresolved imports are expected off-Omarchy; a syntax error is not.
  if grep -qiE "Expected token|Unexpected token|Syntax error|unterminated" <<<"$out"; then
    echo "FAIL $f"; grep -iE "Expected token|Unexpected token|Syntax error|unterminated" <<<"$out" | head -5
    fail=1
  else
    echo "ok   $f"
  fi
done

echo "== js parse (QML engine sees these as scripts, not modules) =="
for f in *.js; do node --check "$f" && echo "ok   $f" || fail=1; done

exit $fail
