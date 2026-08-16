#!/usr/bin/env bash
# Structural checks on the QML and manifest.
#
# Two modes, because the useful checks need different environments:
#
#   default   syntax only. Runs anywhere qmllint exists. This is what CI can
#             honestly assert: a bare runner has no Quickshell and no Omarchy
#             shell, so every type resolves to nothing and semantic diagnostics
#             are noise rather than signal.
#   --strict  every diagnostic qmllint emits, minus the categories that
#             genuinely cannot resolve without the Omarchy shell. Run this on a
#             machine that has Omarchy; it is what caught Service.qml shadowing
#             QQuickItem.states.
#
# Either way, a missing qmllint is a failure, never a silent pass.
set -uo pipefail
cd "$(dirname "$0")/.."

strict=0
[ "${1:-}" = "--strict" ] && strict=1

fail=0
QMLLINT="${QMLLINT:-$(command -v qmllint || command -v qmllint6 || echo /usr/lib/qt6/bin/qmllint)}"

echo "== manifest =="
node scripts/check-manifest.js || fail=1

echo "== cross-file symbols =="
# The gap this closes: Service.qml once called Config.pinnedFor() long after
# that function was deleted. node --check is per-file, and no test loads QML.
node scripts/check-symbols.js || fail=1

echo "== qml parse ($([ $strict = 1 ] && echo strict || echo syntax)) =="
if ! command -v "$QMLLINT" >/dev/null 2>&1 && [ ! -x "$QMLLINT" ]; then
  echo "FAIL: qmllint not found (set QMLLINT=/path/to/qmllint)"
  echo "      Refusing to report success without parsing the QML."
  exit 1
fi

for f in *.qml; do
  out=$("$QMLLINT" "$f" 2>&1)
  if [ $strict = 1 ]; then
    if grep -qE "Failed to import (QtQuick|QtQml)" <<<"$out"; then
      echo "FAIL $f: qmllint cannot import QtQuick — strict mode needs the Qt QML modules"
      fail=1; continue
    fi
    # Tolerated by name, because qs.Ui and qs.Commons live in the Omarchy shell
    # and everything downstream of an unresolved base type is a consequence, not
    # a defect. [property-override] is deliberately NOT tolerated.
    diags=$(grep -E "^(Error|Warning):" <<<"$out" \
      | grep -viE "\[(unqualified|unresolved-type|inheritance-cycle|missing-property|uncreatable-type|missing-type|import)\]" \
      | grep -viE "no matching signal found for handler|is not a type|is not resolved|was not found|Cannot load|no matching import|builtins" \
      | grep -viE "(Quickshell|qs\.Ui|qs\.Commons)" || true)
  else
    diags=$(grep -iE "Expected token|Unexpected token|Syntax error|unterminated|Unexpected character" <<<"$out" || true)
  fi

  if [ -n "$diags" ]; then
    echo "FAIL $f"; { echo "$diags" | head -8; } 2>/dev/null; fail=1
  else
    echo "ok   $f"
  fi
done

echo "== js parse =="
for f in *.js; do node --check "$f" && echo "ok   $f" || fail=1; done

exit $fail
