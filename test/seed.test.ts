import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPreseed } from "../src/seed/preseed.js";
import { buildUserData } from "../src/seed/cloudinit.js";
import { buildArchScript } from "../src/seed/arch.js";
import { defaultBootCommand, installerKindFor } from "../src/bootCommand.js";
import { parseBootCommand } from "../src/keymap.js";

const opts = { hostname: "h", username: "u", password: "p" };

test("Ubuntu autologin covers lightdm as well as gdm3", () => {
  const s = buildUserData({ ...opts, autologin: true }, "hash");
  assert.match(s, /autologin-user=u\\\\n.*lightdm\.conf\.d\/90-vmware-mcp\.conf/);
  assert.match(s, /AutomaticLogin=u\\\\n.*gdm3\/custom\.conf/);
});

test("setupCommands reach both answer files with quoting intact", () => {
  const cmds = [`printf '%s\\n' "it's \\"q\\" $HOME" > /etc/x && echo ok`, "touch /root/y"];
  for (const s of [buildPreseed({ ...opts, setupCommands: cmds }), buildUserData({ ...opts, setupCommands: cmds }, "hash")]) {
    const b64 = s.match(/echo ([A-Za-z0-9+/=]+) \| base64 -d/)![1];
    assert.equal(Buffer.from(b64, "base64").toString(), cmds.join("\n") + "\n");
  }
  assert.match(buildPreseed({ ...opts, setupCommands: cmds }), /in-target sh -c 'echo /);
  assert.match(buildUserData({ ...opts, setupCommands: cmds }, "hash"), /curtin in-target -- sh -c 'echo /);
});

test("Arch script creates the user from a quoted hash, installs Tools and extras, and drops the marker", () => {
  const cmds = [`echo "it's" > /etc/x`];
  const s = buildArchScript({ hostname: "h", username: "u", autologin: true, extraPackages: ["xfce4", "lightdm"], setupCommands: cmds }, "$6$salt$h'x");
  assert.match(s, /useradd -m -G wheel -p '\$6\$salt\$h'\\''x' 'u'/);
  assert.match(s, /pacstrap -K \/mnt .*'open-vm-tools' 'gtkmm3' 'xfce4' 'lightdm'\n/);
  assert.match(s, /systemctl enable NetworkManager sshd vmtoolsd vmware-vmblock-fuse lightdm\n/);
  assert.match(s, /%wheel ALL=\(ALL:ALL\) ALL'/);
  assert.doesNotMatch(s, /NOPASSWD/);
  assert.match(s, /autologin-user=%s.*' 'u' "\$session"/);
  assert.match(s, /> \/var\/log\/vmware-mcp-ready\n/);
  const b64 = s.match(/arch-chroot \/mnt sh -c 'echo ([A-Za-z0-9+/=]+) \| base64 -d/)![1];
  assert.equal(Buffer.from(b64, "base64").toString(), cmds.join("\n") + "\n");
});

test("Arch installs through APT_PROXY over http but leaves the guest on the direct https mirror", () => {
  delete process.env.APT_PROXY;
  assert.doesNotMatch(buildArchScript(opts, "hash"), /http_proxy|Server = http:/);
  process.env.APT_PROXY = "http://10.0.0.1:3142";
  try {
    const s = buildArchScript(opts, "hash");
    assert.match(s, /export http_proxy='http:\/\/10\.0\.0\.1:3142'\necho 'Server = http:\/\/mirror\.init7\.net\/archlinux\/\$repo\/os\/\$arch' > \/etc\/pacman\.d\/mirrorlist/);
    assert.match(s, /echo 'Server = https:\/\/mirror\.init7\.net\/archlinux\/\$repo\/os\/\$arch' > \/mnt\/etc\/pacman\.d\/mirrorlist/);
  } finally {
    delete process.env.APT_PROXY;
  }
});

test("Arch ISOs get the arch installer and a boot command that parses", () => {
  assert.equal(installerKindFor("other", "archlinux-2026.10.01-x86_64.iso"), "arch");
  const { command } = defaultBootCommand("arch", { seedUrl: "http://192.168.88.1:8080" });
  assert.match(command, /script=http:\/\/192\.168\.88\.1:8080\/a<enter>$/);
  assert.ok(parseBootCommand(command).length > 0);
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
