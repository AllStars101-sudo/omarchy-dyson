#!/usr/bin/env bash
# Structural checks on the QML and manifest. Full type checking is impossible
# outside Omarchy — qs.Ui and qs.Commons live in the shell — so this asserts
# what CAN be checked without it, and fails hard rather than passing silently
# when a tool is missing.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
QMLLINT="${QMLLINT:-$(command -v qmllint || command -v qmllint6 || echo /usr/lib/qt6/bin/qmllint)}"

echo "== manifest =="
node scripts/check-manifest.js || fail=1

echo "== cross-file symbols =="
# The gap this closes: Service.qml once called Config.pinnedFor() long after
# that function was deleted. Nothing caught it — node --check is per-file, and
# no test can see a QML-to-JS reference.
node scripts/check-symbols.js || fail=1

echo "== qml parse =="
if [ ! -x "$QMLLINT" ] && ! command -v "$QMLLINT" >/dev/null 2>&1; then
  echo "FAIL: qmllint not found (set QMLLINT=/path/to/qmllint)"
  echo "      Refusing to report success without actually parsing the QML."
  exit 1
fi
for f in *.qml; do
  out=$("$QMLLINT" "$f" 2>&1)
  # Unresolved qs.Ui / qs.Commons imports and the warnings that cascade from
  # them are expected off-Omarchy. Everything else is a real diagnostic.
  # Off-Omarchy, qs.Ui and qs.Commons cannot resolve, and a cascade of
  # diagnostics follows from that alone: unresolved base types, unqualified
  # access into them, signals and properties that cannot be found. Those
  # categories are tolerated by name. Everything else — notably
  # [property-override], which caught Service.qml shadowing QQuickItem.states —
  # fails the build. Tolerating a category is a deliberate act, not a catch-all.
  filtered=$(grep -E "^(Error|Warning):" <<<"$out" \
    | grep -viE "\[(unqualified|unresolved-type|inheritance-cycle|missing-property|uncreatable-type|missing-type|import)\]" \
    | grep -viE "no matching signal found for handler|is not a type|was not found|Cannot load|no matching import" \
    | grep -viE "(Quickshell|qs\.Ui|qs\.Commons)" || true)

  # Base modules failing to import means the linter cannot see QtQuick at all,
  # so nothing below it is meaningful. Fail loudly rather than let the run go
  # green on a lint that checked nothing.
  if grep -qE "Failed to import (QtQuick|QtQml)" <<<"$out"; then
    echo "FAIL $f: qmllint cannot import QtQuick — install the qml6-module-qtquick packages"
    fail=1
    continue
  fi
  if [ -n "$filtered" ]; then
    echo "FAIL $f"; { echo "$filtered" | head -8; } 2>/dev/null; fail=1
  else
    echo "ok   $f"
  fi
done

echo "== js parse =="
for f in *.js; do node --check "$f" && echo "ok   $f" || fail=1; done

exit $fail
