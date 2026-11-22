/**
 * Ubuntu autoinstall (Subiquity) via a cloud-init NoCloud seed.
 *
 * The seed goes on a second CD-ROM labelled CIDATA, which cloud-init discovers
 * on its own — so the boot command only has to add the `autoinstall` kernel
 * argument, not a `ds=nocloud;s=...` locator.
 */

import { aptProxyLateCommands, autologinLateCommands, setupScriptCommand } from "./preseed.js";

export interface CloudInitOptions {
  hostname: string;
  username: string;
  password: string;
  locale?: string;
  keyboardLayout?: string;
  timezone?: string;
  /** Log the desktop user in automatically once installed. */
  autologin?: boolean;
  extraPackages?: string[];
  lateCommands?: string[];
  /** Run as root inside the installed system at the end of the install. */
  setupCommands?: string[];
  /** Full-disk install target. */
  diskMatchSize?: "largest" | "smallest";
}

export { sha512Crypt } from "./sha512crypt.js";

export function buildUserData(o: CloudInitOptions, passwordHash: string): string {
  const packages = [
    "open-vm-tools",
    ...(o.autologin ? ["open-vm-tools-desktop"] : []),
    "openssh-server",
    ...(o.extraPackages ?? []),
  ];

  const late: string[] = [];
  if (o.autologin) late.push(...autologinLateCommands(o.username, "custom.conf"));
  if (process.env.APT_PROXY) late.push(...aptProxyLateCommands(process.env.APT_PROXY));
  late.push(`printf 'provisioned\\n' > /target/var/log/vmware-mcp-ready`);
  late.push(...(o.lateCommands ?? []));
  if (o.setupCommands?.length) late.push(`curtin in-target -- ${setupScriptCommand(o.setupCommands)}`);

  return `#cloud-config
autoinstall:
  version: 1
  locale: ${o.locale ?? "en_US.UTF-8"}
  keyboard:
    layout: ${o.keyboardLayout ?? "us"}
  timezone: ${o.timezone ?? "Etc/UTC"}
${process.env.APT_PROXY ? `  proxy: ${process.env.APT_PROXY}\n` : ""}  identity:
    hostname: ${o.hostname}
    username: ${o.username}
    password: "${passwordHash}"
  ssh:
    install-server: true
    allow-pw: true
  storage:
    layout:
      name: direct
      match:
        size: ${o.diskMatchSize ?? "largest"}
  packages:
${packages.map((p) => `    - ${p}`).join("\n")}
  user-data:
    disable_root: false
  late-commands:
${late.map((c) => `    - ${JSON.stringify(["sh", "-c", c])}`).join("\n")}
  shutdown: reboot
`;
}

export function buildMetaData(instanceId: string, hostname: string): string {
  return `instance-id: ${instanceId}\nlocal-hostname: ${hostname}\n`;
}
