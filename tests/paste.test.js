const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const Paste = require("../Paste.js")

describe("bounded clipboard read", () => {
  test("the command caps both bytes and time, with limits passed as arguments", () => {
    const command = Paste.readCommand()
    assert.deepEqual(command.slice(0, 2), ["sh", "-c"])
    assert.match(command[2], /timeout "\$1" wl-paste /)
    assert.match(command[2], /\| head -c "\$2"$/)
    assert.deepEqual(command.slice(3), ["sh", String(Paste.READ_TIMEOUT_SECONDS), String(Paste.READ_LIMIT_BYTES)])
  })
})

describe("singleLine", () => {
  test("keeps only the first line", () => {
    assert.equal(Paste.singleLine("token\nsecond line"), "token")
    assert.equal(Paste.singleLine("token\r\nsecond"), "token")
  })

  test("drops control characters and trims", () => {
    assert.equal(Paste.singleLine("  ab\u0000c\td\u007f  "), "abcd")
  })

  test("treats missing input as empty", () => {
    assert.equal(Paste.singleLine(undefined), "")
    assert.equal(Paste.singleLine(null), "")
  })
})

describe("spliced", () => {
  test("inserts at the cursor", () => {
    assert.deepEqual(Paste.spliced("http://", 7, 7, "ha.local:8123", 100),
      { text: "http://ha.local:8123", cursor: 20 })
  })

  test("replaces the selection, in either direction", () => {
    assert.deepEqual(Paste.spliced("abcdef", 1, 4, "X", 100), { text: "aXef", cursor: 2 })
    assert.deepEqual(Paste.spliced("abcdef", 4, 1, "X", 100), { text: "aXef", cursor: 2 })
  })

  test("never grows past the field's maximum length", () => {
    const result = Paste.spliced("abc", 3, 3, "x".repeat(50), 10)
    assert.equal(result.text, "abc" + "x".repeat(7))
    assert.equal(result.cursor, 10)
  })

  test("a full field takes nothing more, but a selection frees room", () => {
    assert.deepEqual(Paste.spliced("abcde", 5, 5, "zz", 5), { text: "abcde", cursor: 5 })
    assert.deepEqual(Paste.spliced("abcde", 0, 5, "zz", 5), { text: "zz", cursor: 2 })
  })

  test("falls back to the read limit when no maximum is given", () => {
    const result = Paste.spliced("", 0, 0, "y".repeat(Paste.READ_LIMIT_BYTES + 100), 0)
    assert.equal(result.text.length, Paste.READ_LIMIT_BYTES)
  })

  test("clamps positions outside the text", () => {
    assert.deepEqual(Paste.spliced("abc", -5, 99, "Z", 100), { text: "Z", cursor: 1 })
    assert.deepEqual(Paste.spliced("", undefined, undefined, "Z", 100), { text: "Z", cursor: 1 })
  })
})
