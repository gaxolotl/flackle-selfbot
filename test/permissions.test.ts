import { describe, expect, test } from "bun:test";
import {
  ALL_PERMISSIONS,
  KNOWN_PERMISSIONS,
  PermissionFlags,
  computePermissions,
  formatPermissions,
  hasPermission,
  permissionNames,
  permissionsFrom,
  toBitfield,
} from "../src/permissions.ts";
import type { Role } from "../src/types.ts";

const everyone: Role = {
  id: "100",
  name: "@everyone",
  permissions: String(PermissionFlags.ViewChannel | PermissionFlags.SendMessages),
  is_everyone: true,
};

const moderator: Role = {
  id: "200",
  name: "Moderator",
  permissions: String(PermissionFlags.ManageMessages | PermissionFlags.AddReactions),
};

const member = {
  user: { id: "900", username: "gax" },
  role_ids: ["200"],
};

describe("permission bitfields", () => {
  test("matches the web client's bit values", () => {
    expect(PermissionFlags.ViewChannel).toBe(1n);
    expect(PermissionFlags.SendMessages).toBe(2n);
    expect(PermissionFlags.Administrator).toBe(8192n);
    expect(PermissionFlags.PinMessages).toBe(2147483648n);
    expect(PermissionFlags.SaveMedia).toBe(4294967296n);
  });

  test("ALL_PERMISSIONS covers the server's full 33-bit field", () => {
    expect(ALL_PERMISSIONS).toBe(8589934591n);
    expect(KNOWN_PERMISSIONS).toBeLessThan(ALL_PERMISSIONS);
    expect(KNOWN_PERMISSIONS & (1n << 19n)).toBe(0n);
    expect(KNOWN_PERMISSIONS & PermissionFlags.SaveMedia).toBe(PermissionFlags.SaveMedia);
  });

  test("parses decimal strings and decodes names", () => {
    const bits = toBitfield("3");
    expect(bits).toBe(3n);
    expect(permissionNames(bits)).toEqual(["ViewChannel", "SendMessages"]);
    expect(permissionsFrom(["ViewChannel", "SendMessages"])).toBe(3n);
    expect(formatPermissions(3n)).toBe("ViewChannel | SendMessages");
  });

  test("administrator implies every permission", () => {
    expect(hasPermission(PermissionFlags.Administrator, "ManageServer")).toBe(true);
    expect(hasPermission(PermissionFlags.SendMessages, "ManageServer")).toBe(false);
  });
});

describe("computePermissions", () => {
  test("unions the everyone and member roles", () => {
    const bits = computePermissions({
      userId: "900",
      member,
      roles: [everyone, moderator],
    });
    expect(hasPermission(bits, "ViewChannel")).toBe(true);
    expect(hasPermission(bits, "ManageMessages")).toBe(true);
    expect(hasPermission(bits, "BanMembers")).toBe(false);
  });

  test("applies everyone, role and member overwrites in order", () => {
    const bits = computePermissions({
      userId: "900",
      member,
      roles: [everyone, moderator],
      overwrites: [
        // @everyone loses Send Messages in the channel.
        {
          role_id: "100",
          allow: "0",
          deny: String(PermissionFlags.SendMessages),
        },
        // The moderator role gains Manage Channels.
        {
          role_id: "200",
          allow: String(PermissionFlags.ManageChannels),
          deny: "0",
        },
        // This specific member is allowed to send again.
        {
          user_id: "900",
          allow: String(PermissionFlags.SendMessages),
          deny: "0",
        },
      ],
    });

    expect(hasPermission(bits, "SendMessages")).toBe(true);
    expect(hasPermission(bits, "ManageChannels")).toBe(true);
    expect(hasPermission(bits, "ViewChannel")).toBe(true);
  });

  test("owners and administrators bypass overwrites", () => {
    const ownerBits = computePermissions({
      userId: "900",
      ownerId: "900",
      member,
      roles: [everyone],
      overwrites: [{ role_id: "100", allow: "0", deny: String(ALL_PERMISSIONS) }],
    });
    expect(ownerBits).toBe(ALL_PERMISSIONS);

    const adminBits = computePermissions({
      userId: "900",
      member: { role_ids: ["300"] },
      roles: [
        everyone,
        { id: "300", name: "Admin", permissions: String(PermissionFlags.Administrator) },
      ],
      overwrites: [{ role_id: "100", allow: "0", deny: String(ALL_PERMISSIONS) }],
    });
    expect(adminBits).toBe(ALL_PERMISSIONS);
  });
});
