/**
 * Debian-installer preseed, used for both Debian and Kali (Kali ships the Debian
 * installer). Delivered over HTTP via `auto url=...` typed at the boot prompt.
 */

export interface PreseedOptions {
  hostname: string;
  domain?: string;
  username: string;
  password: string;
  /** Root is locked by default; the user gets sudo instead. */
  rootPassword?: string;
  locale?: string;
  keymap?: string;
  timezone?: string;
  /** Kali's default mirror differs from Debian's. */
  mirrorHostname?: string;
  mirrorDirectory?: string;
  /** tasksel task list, e.g. ["standard"] or ["kali-desktop-xfce"]. */
  tasks?: string[];
  extraPackages?: string[];
  /** Log the desktop user in automatically once installed. */
  autologin?: boolean;
  lateCommands?: string[];
  /** Run as root inside the installed system at the end of the install. */
  setupCommands?: string[];
  /**
   * Resolvers appended to the installer's own /etc/resolv.conf before the mirror
   * step. VMware's NAT DNS forwarder (the .2 address on the vmnet) is the single
   * most common reason an otherwise-correct unattended install dies at
   * "Configure the package manager" — the installer reports "architecture not
   * supported by selected mirror", which is really just a failed lookup.
   * Appending a public resolver costs nothing and removes that failure mode.
   */
  fallbackDns?: string[];
}

// The installed system uses the proxy only while it answers, so apt keeps working when the cache is off.
// Debian leaves the install-time proxy in apt.conf, Ubuntu in 90curtin-aptproxy and a snapd drop-in.
export function aptProxyLateCommands(proxy: string): string[] {
  const { hostname, port } = new URL(proxy);
  return [
    `printf '#!/bin/sh\\ntimeout 1 bash -c "</dev/tcp/${hostname}/${port || 80}" 2>/dev/null && echo ${proxy} || echo DIRECT\\n' > /target/usr/local/bin/apt-proxy-detect`,
    `chmod 755 /target/usr/local/bin/apt-proxy-detect`,
    `printf 'Acquire::http::Proxy-Auto-Detect "/usr/local/bin/apt-proxy-detect";\\n' > /target/etc/apt/apt.conf.d/00proxy-detect`,
    `rm -f /target/etc/apt/apt.conf.d/90curtin-aptproxy /target/etc/systemd/system/snapd.service.d/snap_proxy.conf`,
    `[ ! -f /target/etc/apt/apt.conf ] || sed -i '/Acquire::http::Proxy /d' /target/etc/apt/apt.conf`,
  ];
}

// Runs root commands in the installed system; base64 keeps any quoting intact through both installers.
// The caller prefixes the installer's chroot runner (in-target / curtin in-target --).
export function setupScriptCommand(commands: string[]): string {
  const b64 = Buffer.from(commands.join("\n") + "\n").toString("base64");
  return `sh -c 'echo ${b64} | base64 -d > /root/vmware-mcp-setup.sh; sh -e /root/vmware-mcp-setup.sh > /var/log/vmware-mcp-setup.log 2>&1 || { echo "exit status $?" >> /var/log/vmware-mcp-setup.log; touch /var/log/vmware-mcp-setup.failed; }; rm -f /root/vmware-mcp-setup.sh'`;
}

// Cover both display managers the Debian family ships; gdm3 reads daemon.conf on Debian, custom.conf on Ubuntu.
export function autologinLateCommands(user: string, gdmConf: string): string[] {
  return [
    `mkdir -p /target/etc/lightdm/lightdm.conf.d`,
    `printf '[Seat:*]\\nautologin-user=${user}\\nautologin-user-timeout=0\\n' > /target/etc/lightdm/lightdm.conf.d/90-vmware-mcp.conf`,
    `mkdir -p /target/etc/gdm3`,
    `printf '[daemon]\\nAutomaticLoginEnable=true\\nAutomaticLogin=${user}\\n' > /target/etc/gdm3/${gdmConf}`,
  ];
}

export function buildPreseed(o: PreseedOptions): string {
  const locale = o.locale ?? "en_US.UTF-8";
  const keymap = o.keymap ?? "us";
  const tz = o.timezone ?? "Etc/UTC";
  const mirrorHost = o.mirrorHostname ?? "deb.debian.org";
  const mirrorDir = o.mirrorDirectory ?? "/debian";
  const tasks = o.tasks ?? ["standard"];

  // open-vm-tools is what makes every guest_* tool work afterwards, so it is
  // never optional. sudo is needed because root login is left disabled.
  const packages = [
    "open-vm-tools",
    "sudo",
    "openssh-server",
    ...(o.autologin ? ["open-vm-tools-desktop"] : []),
    ...(o.extraPackages ?? []),
  ];

  const late: string[] = [];
  if (o.autologin) {
    late.push(
      ...autologinLateCommands(o.username, "daemon.conf"),
      `in-target /bin/sh -c 'getent group autologin || groupadd -r autologin'`,
      `in-target /usr/sbin/usermod -aG autologin ${o.username} || true`,
    );
  }
  if (process.env.APT_PROXY) late.push(...aptProxyLateCommands(process.env.APT_PROXY));
  // Marker the provisioner polls for.
  late.push(`printf 'provisioned\\n' > /target/var/log/vmware-mcp-ready`);
  late.push(...(o.lateCommands ?? []));
  if (o.setupCommands?.length) late.push(`in-target ${setupScriptCommand(o.setupCommands)}`);

  const dns = o.fallbackDns ?? ["1.1.1.1", "8.8.8.8"];

  return `#### vmware-mcp generated preseed — unattended install
### Put public resolvers FIRST, ahead of the DHCP-supplied one, before the mirror
### step runs. VMware's NAT forwards guest DNS to the host's resolver, so a broken
### router DNS breaks the install — and it surfaces as the misleading "architecture
### not supported by selected mirror". Order matters: appending is not enough,
### because the installer's resolver tries the DHCP entry first and stalls on it.
d-i preseed/early_command string cp /etc/resolv.conf /tmp/resolv.orig; printf '${dns.map((d) => `nameserver ${d}\\n`).join("")}' > /etc/resolv.conf; cat /tmp/resolv.orig >> /etc/resolv.conf

d-i debian-installer/locale string ${locale}
d-i keyboard-configuration/xkb-keymap select ${keymap}

### Network
d-i netcfg/choose_interface select auto
d-i netcfg/get_hostname string ${o.hostname}
d-i netcfg/get_domain string ${o.domain ?? "local"}
d-i netcfg/hostname string ${o.hostname}
d-i netcfg/wireless_wep string

### Mirror
d-i mirror/country string manual
d-i mirror/http/hostname string ${mirrorHost}
d-i mirror/http/directory string ${mirrorDir}
d-i mirror/http/proxy string ${process.env.APT_PROXY ?? ""}

### Clock
d-i clock-setup/utc boolean true
d-i time/zone string ${tz}
d-i clock-setup/ntp boolean true

### Accounts — root locked, user gets sudo
${
  o.rootPassword
    ? `d-i passwd/root-login boolean true\nd-i passwd/root-password password ${o.rootPassword}\nd-i passwd/root-password-again password ${o.rootPassword}`
    : `d-i passwd/root-login boolean false`
}
d-i passwd/user-fullname string ${o.username}
d-i passwd/username string ${o.username}
d-i passwd/user-password password ${o.password}
d-i passwd/user-password-again password ${o.password}
d-i user-setup/allow-password-weak boolean true
d-i user-setup/encrypt-home boolean false

### Partitioning — wipe the disk, one big root
d-i partman-auto/method string regular
d-i partman-auto/choose_recipe select atomic
d-i partman-lvm/device_remove_lvm boolean true
d-i partman-md/device_remove_md boolean true
d-i partman-partitioning/confirm_write_new_label boolean true
d-i partman/choose_partition select finish
d-i partman/confirm boolean true
d-i partman/confirm_nooverwrite boolean true
d-i partman-efi/non_efi_system boolean true

### Packages
tasksel tasksel/first multiselect ${tasks.join(", ")}
d-i pkgsel/include string ${packages.join(" ")}
d-i pkgsel/upgrade select none
popularity-contest popularity-contest/participate boolean false

### Bootloader
d-i grub-installer/only_debian boolean true
d-i grub-installer/with_other_os boolean true
d-i grub-installer/bootdev string default

### Finish without prompting
d-i finish-install/reboot_in_progress note
d-i debian-installer/exit/poweroff boolean false

### Post-install
d-i preseed/late_command string \\
${late.map((c) => `  ${c}`).join(" ; \\\n")}
`;
}

/** Kali's mirror and default desktop task differ from stock Debian. */
export function kaliDefaults(): Partial<PreseedOptions> {
  return {
    mirrorHostname: "http.kali.org",
    mirrorDirectory: "/kali",
    tasks: ["kali-desktop-xfce", "kali-tools-top10"],
  };
}
