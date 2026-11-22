import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreseed } from "../src/seed/preseed.js";
import { buildUserData } from "../src/seed/cloudinit.js";

const opts = { hostname: "h", username: "u", password: "p" };

test("Ubuntu autologin covers lightdm as well as gdm3", () => {
  const s = buildUserData({ ...opts, autologin: true }, "hash");
  assert.match(s, /autologin-user=u\\\\n.*lightdm\.conf\.d\/90-vmware-mcp\.conf/);
  assert.match(s, /AutomaticLogin=u\\\\n.*gdm3\/custom\.conf/);
});

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
