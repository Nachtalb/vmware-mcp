/**
 * Arch Linux: a plain install script, fetched and run by the live ISO itself via
 * its `script=` boot parameter (archiso's automated_script, which waits for the
 * network first). A script instead of archinstall's JSON config, whose schema
 * changes between ISO releases.
 */

import { setupScriptCommand } from "./preseed.js";

export interface ArchOptions {
  hostname: string;
  username: string;
  locale?: string;
  timezone?: string;
  autologin?: boolean;
  extraPackages?: string[];
  setupCommands?: string[];
}

// Always direct, never APT_PROXY: apt-cacher-ng's expiry misreads Arch repo dbs and drops current packages.
const MIRROR = "mirror.init7.net/archlinux/$repo/os/$arch";
const DISPLAY_MANAGERS = ["lightdm", "gdm", "sddm", "lxdm"];

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function buildArchScript(o: ArchOptions, passwordHash: string): string {
  const locale = o.locale ?? "en_US.UTF-8";
  const charset = locale.split(".")[1] ?? "UTF-8";
  const packages = [
    "base", "linux", "grub", "sudo", "openssh", "networkmanager", "inetutils", "open-vm-tools",
    ...(o.autologin ? ["gtkmm3"] : []),
    ...(o.extraPackages ?? []),
  ];
  const u = q(o.username);

  const chroot = [
    `echo ${q(o.hostname)} > /etc/hostname`,
    `ln -sf ${q(`/usr/share/zoneinfo/${o.timezone ?? "Etc/UTC"}`)} /etc/localtime`,
    `echo ${q(`${locale} ${charset}`)} >> /etc/locale.gen`,
    `locale-gen`,
    `echo ${q(`LANG=${locale}`)} > /etc/locale.conf`,
    `useradd -m -G wheel -p ${q(passwordHash)} ${u}`,
    `passwd -l root`,
    `echo '%wheel ALL=(ALL:ALL) ALL' > /etc/sudoers.d/10-wheel`,
    `chmod 440 /etc/sudoers.d/10-wheel`,
    `systemctl enable NetworkManager sshd vmtoolsd vmware-vmblock-fuse ${DISPLAY_MANAGERS.filter((d) => packages.includes(d)).join(" ")}`,
  ];
  if (o.autologin) {
    chroot.push(
      `groupadd -rf autologin`,
      `gpasswd -a ${u} autologin`,
      `mkdir -p /etc/lightdm/lightdm.conf.d /etc/gdm`,
      // lightdm finds no session to autologin into unless one is named.
      `session=$(basename -s .desktop $(ls /usr/share/xsessions/*.desktop 2>/dev/null | head -1) 2>/dev/null || true)`,
      `printf '[Seat:*]\\nautologin-user=%s\\nautologin-user-timeout=0\\nautologin-session=%s\\n' ${u} "$session" > /etc/lightdm/lightdm.conf.d/90-vmware-mcp.conf`,
      `printf '[daemon]\\nAutomaticLoginEnable=True\\nAutomaticLogin=%s\\n' ${u} > /etc/gdm/custom.conf`,
    );
  }
  chroot.push(`grub-mkconfig -o /boot/grub/grub.cfg`, `printf 'provisioned\\n' > /var/log/vmware-mcp-ready`);

  return `#!/bin/bash
# vmware-mcp generated Arch install
set -euxo pipefail
systemctl stop reflector.service || true
systemctl start pacman-init.service
echo ${q(`Server = https://${MIRROR}`)} > /etc/pacman.d/mirrorlist
disk=/dev/$(lsblk -dno NAME,TYPE | awk '$2=="disk"{print $1; exit}')
wipefs -af "$disk"
echo 'type=83,bootable' | sfdisk "$disk"
udevadm settle
part=$(lsblk -lnpo NAME,TYPE "$disk" | awk '$2=="part"{print $1; exit}')
mkfs.ext4 -F "$part"
mount "$part" /mnt
pacstrap -K /mnt ${packages.map(q).join(" ")}
genfstab -U /mnt >> /mnt/etc/fstab
arch-chroot /mnt grub-install --target=i386-pc "$disk"
arch-chroot /mnt /bin/bash -euxo pipefail <<'VMWARE_MCP_EOF'
${chroot.join("\n")}
VMWARE_MCP_EOF
${o.setupCommands?.length ? `arch-chroot /mnt ${setupScriptCommand(o.setupCommands)}\n` : ""}echo ${q(`Server = https://${MIRROR}`)} > /mnt/etc/pacman.d/mirrorlist
sync
# pacstrap -K can leave a gpg-agent holding /mnt busy; the reboot unmounts anyway
umount -R /mnt || true
reboot
`;
}
