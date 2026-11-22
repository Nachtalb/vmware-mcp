import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreseed } from "../src/seed/preseed.js";

const opts = { hostname: "h", username: "u", password: "p" };

test("APT_PROXY installs the proxy auto-detect script only when set", () => {
  delete process.env.APT_PROXY;
  assert.doesNotMatch(buildPreseed(opts), /apt-proxy-detect/);
  process.env.APT_PROXY = "http://10.0.0.1:3142";
  try {
    const s = buildPreseed(opts);
    assert.match(s, /d-i mirror\/http\/proxy string http:\/\/10\.0\.0\.1:3142\n/);
    assert.match(s, /<\/dev\/tcp\/10\.0\.0\.1\/3142" 2>\/dev\/null && echo http:\/\/10\.0\.0\.1:3142 \|\| echo DIRECT/);
  } finally {
    delete process.env.APT_PROXY;
  }
});
