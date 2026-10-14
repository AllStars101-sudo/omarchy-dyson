const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const Field = require("../BoundedField.js")

describe("bounded clipboard read", () => {
  test("the command caps both bytes and time, with limits passed as arguments", () => {
    const command = Field.readCommand()
    assert.deepEqual(command.slice(0, 2), ["sh", "-c"])
    assert.match(command[2], /timeout "\$1" wl-paste /)
    assert.match(command[2], /\| head -c "\$2"$/)
    assert.deepEqual(command.slice(3), ["sh", String(Field.READ_TIMEOUT_SECONDS), String(Field.READ_LIMIT_BYTES)])
  })
})

describe("singleLine", () => {
  test("keeps only the first line", () => {
    assert.equal(Field.singleLine("token\nsecond line"), "token")
    assert.equal(Field.singleLine("token\r\nsecond"), "token")
  })

  test("drops control characters and trims", () => {
    assert.equal(Field.singleLine("  ab\u0000c\td\u007f  "), "abcd")
  })

  test("treats missing input as empty", () => {
    assert.equal(Field.singleLine(undefined), "")
    assert.equal(Field.singleLine(null), "")
  })
})

describe("pasted", () => {
  test("inserts at the cursor", () => {
    assert.deepEqual(Field.pasted("http://", 7, 7, "ha.local:8123", 100),
      { from: 7, to: 7, insert: "ha.local:8123", cursor: 20 })
  })

  test("replaces the selection, in either direction", () => {
    assert.deepEqual(Field.pasted("abcdef", 1, 4, "X", 100), { from: 1, to: 4, insert: "X", cursor: 2 })
    assert.deepEqual(Field.pasted("abcdef", 4, 1, "X", 100), { from: 1, to: 4, insert: "X", cursor: 2 })
  })

  test("never grows past the field's maximum length", () => {
    assert.deepEqual(Field.pasted("abc", 3, 3, "x".repeat(50), 10),
      { from: 3, to: 3, insert: "x".repeat(7), cursor: 10 })
  })

  test("a full field takes nothing more, but a selection frees room", () => {
    assert.deepEqual(Field.pasted("abcde", 5, 5, "zz", 5), { from: 5, to: 5, insert: "", cursor: 5 })
    assert.deepEqual(Field.pasted("abcde", 0, 5, "zz", 5), { from: 0, to: 5, insert: "zz", cursor: 2 })
  })

  test("falls back to the read limit when no maximum is given", () => {
    const edit = Field.pasted("", 0, 0, "y".repeat(Field.READ_LIMIT_BYTES + 100), 0)
    assert.equal(edit.insert.length, Field.READ_LIMIT_BYTES)
  })

  test("clamps positions outside the text", () => {
    assert.deepEqual(Field.pasted("abc", -5, 99, "Z", 100), { from: 0, to: 3, insert: "Z", cursor: 1 })
    assert.deepEqual(Field.pasted("", undefined, undefined, "Z", 100), { from: 0, to: 0, insert: "Z", cursor: 1 })
    assert.deepEqual(Field.pasted(undefined, 0, 0, "Z", 100), { from: 0, to: 0, insert: "Z", cursor: 1 })
  })
})

describe("typed", () => {
  test("keeps spaces, unlike a paste", () => {
    assert.deepEqual(Field.typed("ab", 2, 2, " ", 100), { from: 2, to: 2, insert: " ", cursor: 3 })
  })

  test("drops control characters and respects the maximum", () => {
    assert.deepEqual(Field.typed("ab", 2, 2, "\u0007c", 100), { from: 2, to: 2, insert: "c", cursor: 3 })
    assert.deepEqual(Field.typed("abc", 3, 3, "d", 3), { from: 3, to: 3, insert: "", cursor: 3 })
  })

  test("replaces the selection", () => {
    assert.deepEqual(Field.typed("abcd", 1, 3, "x", 100), { from: 1, to: 3, insert: "x", cursor: 2 })
  })

  test("treats missing input as nothing typed", () => {
    assert.deepEqual(Field.typed("ab", 1, 1, undefined, 100), { from: 1, to: 1, insert: "", cursor: 1 })
    assert.deepEqual(Field.typed("ab", 1, 1, null, 100), { from: 1, to: 1, insert: "", cursor: 1 })
  })
})

describe("erasure", () => {
  test("a selection goes whichever key is pressed", () => {
    assert.deepEqual(Field.erasure("abcdef", 4, 1, true, false), { from: 1, to: 4, insert: "", cursor: 1 })
    assert.deepEqual(Field.erasure("abcdef", 1, 4, false, true), { from: 1, to: 4, insert: "", cursor: 1 })
  })

  test("backspace removes one character before the cursor", () => {
    assert.deepEqual(Field.erasure("abc", 2, 2, true, false), { from: 1, to: 2, insert: "", cursor: 1 })
  })

  test("delete removes one character after the cursor", () => {
    assert.deepEqual(Field.erasure("abc", 1, 1, false, false), { from: 1, to: 2, insert: "", cursor: 1 })
  })

  test("nothing to remove at the edges", () => {
    assert.equal(Field.erasure("abc", 0, 0, true, false), null)
    assert.equal(Field.erasure("abc", 3, 3, false, false), null)
    assert.equal(Field.erasure("", 0, 0, true, true), null)
  })

  test("ctrl+backspace removes back to the previous word boundary", () => {
    const url = "http://homeassistant.local"
    assert.deepEqual(Field.erasure(url, url.length, url.length, true, true),
      { from: 21, to: url.length, insert: "", cursor: 21 })
    // Separators right before the cursor go with the word behind them.
    assert.deepEqual(Field.erasure("http://", 7, 7, true, true), { from: 0, to: 7, insert: "", cursor: 0 })
  })

  test("ctrl+delete removes forward to the next word boundary", () => {
    assert.deepEqual(Field.erasure("http://homeassistant", 4, 4, false, true),
      { from: 4, to: 20, insert: "", cursor: 4 })
    assert.deepEqual(Field.erasure("ab cd", 0, 0, false, true), { from: 0, to: 2, insert: "", cursor: 0 })
  })
})
