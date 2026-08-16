const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const Config = require("../Config.js")
const Origin = require("../Origin.js")

describe("config parsing", () => {
  test("an empty or missing file yields usable defaults, not an error", () => {
    for (const input of ["", null, undefined, "{}"]) {
      const c = Config.parse(input)
      assert.equal(c.baseUrl, "")
      assert.equal(c.barMetric, "Fan speed")
      assert.equal(c.historyHours, 24)
      assert.equal(c.pollSeconds, 10)
      assert.equal(c.staleSeconds, 300)
      assert.equal(c.autoReconnect, true)
      assert.equal(c.error, "")
    }
  })

  test("a malformed file degrades rather than leaving the plugin dead", () => {
    // The user must still be able to open settings and fix the connection.
    const c = Config.parse("{not json")
    assert.equal(c.error, "config.json is not valid JSON")
    assert.equal(c.barMetric, "Fan speed")
  })

  test("a file that is valid JSON but not an object", () => {
    for (const input of ["[1,2,3]", '"a string"', "42", "null"]) {
      const c = Config.parse(input)
      assert.ok(c.error !== "", `${input} is reported`)
      assert.equal(c.barMetric, "Fan speed")
    }
  })

  test("values are read when present", () => {
    const c = Config.parse(JSON.stringify({
      baseUrl: "http://ha.local:8123", barMetric: "PM2.5", historyHours: 6,
      pollSeconds: 15, staleSeconds: 900, autoReconnect: false
    }))
    assert.equal(c.baseUrl, "http://ha.local:8123")
    assert.equal(c.barMetric, "PM2.5")
    assert.equal(c.historyHours, 6)
    assert.equal(c.pollSeconds, 15)
    assert.equal(c.staleSeconds, 900)
    assert.equal(c.autoReconnect, false)
    assert.equal(c.error, "")
  })

  test("an unrecognised bar metric falls back rather than showing nothing", () => {
    assert.equal(Config.parse('{"barMetric":"nonsense"}').barMetric, "Fan speed")
    assert.equal(Config.parse('{"barMetric":123}').barMetric, "Fan speed")
    assert.equal(Config.parse('{"barMetric":"None"}').barMetric, "None")
  })

  test("out-of-range numbers clamp to the schema bounds", () => {
    assert.equal(Config.parse('{"historyHours":9999}').historyHours, 240)
    assert.equal(Config.parse('{"historyHours":0}').historyHours, 1)
    assert.equal(Config.parse('{"pollSeconds":1}').pollSeconds, 5)
    assert.equal(Config.parse('{"pollSeconds":9999}').pollSeconds, 300)
    assert.equal(Config.parse('{"staleSeconds":1}').staleSeconds, 60)
    assert.equal(Config.parse('{"staleSeconds":99999}').staleSeconds, 3600)
  })

  test("non-numeric numbers fall back to the default", () => {
    assert.equal(Config.parse('{"historyHours":"lots"}').historyHours, 24)
    assert.equal(Config.parse('{"pollSeconds":null}').pollSeconds, 10)
  })

  test("a non-string baseUrl is ignored", () => {
    assert.equal(Config.parse('{"baseUrl":123}').baseUrl, "")
  })

  test("autoReconnect is on unless explicitly false", () => {
    assert.equal(Config.parse('{"autoReconnect":false}').autoReconnect, false)
    assert.equal(Config.parse('{"autoReconnect":true}').autoReconnect, true)
    assert.equal(Config.parse('{"autoReconnect":"no"}').autoReconnect, true,
      "only a real false disables it")
  })
})

describe("config merge and serialize", () => {
  test("merge applies only known keys", () => {
    const base = Config.parse("")
    const next = Config.merge(base, { barMetric: "None", nonsense: true })
    assert.equal(next.barMetric, "None")
    assert.equal(next.nonsense, undefined, "unknown keys are not stored")
    assert.equal(next.pollSeconds, 10, "untouched keys survive")
  })

  test("merge tolerates missing arguments", () => {
    assert.equal(Config.merge(null, null).barMetric, "Fan speed")
    assert.equal(Config.merge(undefined, { baseUrl: "x" }).baseUrl, "x")
    assert.equal(Config.merge({ baseUrl: "y" }, "not an object").baseUrl, "y")
  })

  test("serialize writes every key and nothing extra", () => {
    const out = JSON.parse(Config.serialize(Config.parse("")))
    assert.deepEqual(Object.keys(out).sort(),
      ["autoReconnect", "barMetric", "baseUrl", "historyHours", "pollSeconds", "staleSeconds"])
  })

  test("the runtime error field is never written back to disk", () => {
    const broken = Config.parse("{not json")
    assert.equal(broken.error, "config.json is not valid JSON")
    assert.equal(JSON.parse(Config.serialize(broken)).error, undefined)
  })

  test("serialize handles a null config and ends with a newline", () => {
    const text = Config.serialize(null)
    assert.equal(JSON.parse(text).barMetric, "Fan speed")
    assert.ok(text.endsWith("\n"))
  })

  test("a parse/serialize round trip is stable", () => {
    const text = Config.serialize(Config.parse('{"baseUrl":"http://x:1","barMetric":"None"}'))
    assert.equal(text, Config.serialize(Config.parse(text)))
  })

  test("device pins are deliberately not stored here", () => {
    // Two widgets of this plugin share a module name, so a pin keyed by name
    // could not tell them apart. Pins live on each bar entry instead.
    assert.equal("pinned" in Config.parse(""), false)
    assert.equal(Config.isPlainObject({}), true)
    assert.equal(Config.isPlainObject([]), false)
    assert.equal(Config.isPlainObject(null), false)
    assert.equal(Config.isPlainObject("x"), false)
  })

  test("boundedInt", () => {
    assert.equal(Config.boundedInt(5, 1, 0, 10), 5)
    assert.equal(Config.boundedInt(5.6, 1, 0, 10), 6, "rounds")
    assert.equal(Config.boundedInt(-1, 1, 0, 10), 0)
    assert.equal(Config.boundedInt(99, 1, 0, 10), 10)
    assert.equal(Config.boundedInt("x", 7, 0, 10), 7)
    assert.equal(Config.boundedInt(Infinity, 7, 0, 10), 7)
  })
})

describe("origin normalization", () => {
  // The keyring scopes tokens by origin, so two spellings of one address must
  // normalize identically or a stored token becomes unfindable.
  test("equivalent spellings collapse to one origin", () => {
    const expected = "http://localhost:8123"
    for (const input of ["http://localhost:8123", "http://localhost:8123/",
                         "http://localhost:8123/lovelace/0", "HTTP://LocalHost:8123",
                         "http://localhost:8123?x=1", "http://localhost:8123#frag",
                         "ws://localhost:8123"]) {
      assert.equal(Origin.normalizeOrigin(input), expected, input)
    }
  })

  test("a bare host defaults to https, and https to 443", () => {
    assert.equal(Origin.normalizeOrigin("homeassistant.local"), "https://homeassistant.local:443")
    assert.equal(Origin.normalizeOrigin("https://ha.example.com"), "https://ha.example.com:443")
    assert.equal(Origin.normalizeOrigin("wss://ha.example.com"), "https://ha.example.com:443")
    assert.equal(Origin.normalizeOrigin("//ha.example.com"), "https://ha.example.com:443")
  })

  test("IPv6", () => {
    assert.equal(Origin.normalizeOrigin("http://[::1]:8123"), "http://[::1]:8123")
    assert.equal(Origin.normalizeOrigin("[::1]:8123"), "https://[::1]:8123")
    assert.equal(Origin.normalizeOrigin("http://[2001:db8::1]"), "http://[2001:db8::1]:80")
    assert.equal(Origin.normalizeOrigin("http://[8123]"), "", "a mis-pasted port is not an address")
    assert.equal(Origin.normalizeOrigin("http://[]"), "")
    assert.equal(Origin.normalizeOrigin("http://[::1]x"), "", "junk after the bracket")
    assert.equal(Origin.normalizeOrigin("http://[::1]:"), "", "a colon with no port")
  })

  test("addresses that are not addresses are rejected", () => {
    for (const input of ["", null, undefined, "   ", "ftp://ha.local", "file:///etc/passwd",
                         "http://user:pw@ha.local", "http://ha.local:8123]",
                         "http://ha.local:99999", "http://ha.local:0", "http://ha.local:abc",
                         "http://ha.local:8123:9", "http://ha with space:8123",
                         "http://", "://ha.local", "http://ha_local!:8123",
                         "http://ha.local:", "http://:8123", "http://:"]) {
      assert.equal(Origin.normalizeOrigin(input), "", JSON.stringify(input))
    }
  })

  test("a port must be decimal digits, not anything Number() accepts", () => {
    // Number("0x10") is 16, so without the digit test "…:0x10" would normalize
    // to port 16 — a token stored under one spelling and looked up under
    // another would silently never be found.
    assert.equal(Origin.normalizeOrigin("http://ha.local:0x10"), "")
    assert.equal(Origin.normalizeOrigin("http://ha.local:1e3"), "")
    assert.equal(Origin.normalizeOrigin("http://ha.local: 80"), "")
    assert.equal(Origin.normalizeOrigin("http://ha.local:+80"), "")
  })

  test("the port range boundary", () => {
    assert.equal(Origin.normalizeOrigin("http://ha.local:65535"), "http://ha.local:65535")
    assert.equal(Origin.normalizeOrigin("http://ha.local:65536"), "")
    assert.equal(Origin.normalizeOrigin("http://ha.local:1"), "http://ha.local:1")
  })

  test("preparedUrl", () => {
    assert.equal(Origin.preparedUrl("ha.local"), "https://ha.local")
    assert.equal(Origin.preparedUrl("http://ha.local"), "http://ha.local")
    assert.equal(Origin.preparedUrl("  ha.local  "), "https://ha.local")
    assert.equal(Origin.preparedUrl(""), "")
    assert.equal(Origin.preparedUrl(null), "")
  })

  test("plaintext warning fires only when the token leaves this machine", () => {
    assert.equal(Origin.isPlaintextRemote("http://ha.example.com:8123"), true)
    assert.equal(Origin.isPlaintextRemote("http://192.168.1.20:8123"), true)
    assert.equal(Origin.isPlaintextRemote("http://localhost:8123"), false)
    assert.equal(Origin.isPlaintextRemote("http://127.0.0.1:8123"), false)
    assert.equal(Origin.isPlaintextRemote("http://127.0.1.1:8123"), false)
    assert.equal(Origin.isPlaintextRemote("http://[::1]:8123"), false)
    assert.equal(Origin.isPlaintextRemote("https://ha.example.com:443"), false)
    assert.equal(Origin.isPlaintextRemote(""), false)
    assert.equal(Origin.isPlaintextRemote(null), false)
  })
})
