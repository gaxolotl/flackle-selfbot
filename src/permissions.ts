/**
 * Flackle permission bitfields and helpers.
 *
 * Permission values are decimal strings in API payloads and can exceed 32
 * bits, so everything here uses native `bigint`.
 */

import type { Member, PermissionOverwrite, Role, Snowflake } from "./types.ts";

/** Bit values matching the Flackle web client (module `4374`). */
export const PermissionFlags = {
  ViewChannel: 1n << 0n,
  SendMessages: 1n << 1n,
  AttachFiles: 1n << 2n,
  ManageMessages: 1n << 3n,
  MentionEveryone: 1n << 4n,
  CreateInvite: 1n << 5n,
  KickMembers: 1n << 6n,
  BanMembers: 1n << 7n,
  ManageChannels: 1n << 8n,
  ManageRoles: 1n << 9n,
  ManageServer: 1n << 10n,
  ChangeNickname: 1n << 11n,
  ManageNicknames: 1n << 12n,
  Administrator: 1n << 13n,
  AddReactions: 1n << 14n,
  Connect: 1n << 15n,
  Speak: 1n << 16n,
  MuteMembers: 1n << 17n,
  MoveMembers: 1n << 18n,
  DeafenMembers: 1n << 20n,
  UseVideo: 1n << 21n,
  ManageMembers: 1n << 22n,
  BypassSlowmode: 1n << 26n,
  TimeoutMembers: 1n << 27n,
  BulkDelete: 1n << 28n,
  ViewAuditLog: 1n << 29n,
  ManagePermissions: 1n << 30n,
  PinMessages: 1n << 31n,
  SaveMedia: 1n << 32n,
} as const;

export type PermissionName = keyof typeof PermissionFlags;

/** Lower-case aliases for ergonomic lookups. */
export const Permissions = PermissionFlags;

export type BitfieldResolvable = string | number | bigint | null | undefined;

/**
 * Every permission bit the server currently uses. Flackle stores permissions
 * in a 33-bit field (bits 0-32), including a few bits the web client does not
 * label, so "all permissions" is `(1 << 33) - 1`.
 */
export const ALL_PERMISSIONS: bigint = (1n << 33n) - 1n;

/** OR of every permission known to this library. */
export const KNOWN_PERMISSIONS: bigint = Object.values(PermissionFlags).reduce(
  (all, bit) => all | bit,
  0n,
);

/** Parses a decimal/hex bitfield (or number/bigint) into a bigint. */
export function toBitfield(value: BitfieldResolvable): bigint {
  if (value === null || value === undefined || value === "") return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.trunc(value));
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** Resolves a permission name or raw bitfield value to a bigint. */
export function resolvePermission(permission: PermissionName | BitfieldResolvable): bigint {
  if (typeof permission === "string" && permission in PermissionFlags) {
    return PermissionFlags[permission as PermissionName];
  }
  return toBitfield(permission as BitfieldResolvable);
}

/** True when `permissions` contains `permission`. Administrator implies everything. */
export function hasPermission(
  permissions: BitfieldResolvable,
  permission: PermissionName | BitfieldResolvable,
): boolean {
  const bits = toBitfield(permissions);
  if ((bits & PermissionFlags.Administrator) === PermissionFlags.Administrator) return true;
  const flag = resolvePermission(permission);
  return (bits & flag) === flag && flag !== 0n;
}

/** Alias kept for readability in user code. */
export const has = hasPermission;

/** Returns the names of all set permission bits. */
export function permissionNames(permissions: BitfieldResolvable): PermissionName[] {
  const bits = toBitfield(permissions);
  return (Object.keys(PermissionFlags) as PermissionName[]).filter(
    (name) => (bits & PermissionFlags[name]) === PermissionFlags[name],
  );
}

/** Builds a bitfield from permission names and/or raw bit values. */
export function permissionsFrom(
  permissions: (PermissionName | BitfieldResolvable)[],
): bigint {
  let bits = 0n;
  for (const permission of permissions) bits |= resolvePermission(permission);
  return bits;
}

export interface ComputePermissionsInput {
  userId: Snowflake;
  /** Server owner, if known. Owners bypass all checks. */
  ownerId?: Snowflake | null;
  member: Pick<Member, "role_ids" | "roles"> | { role_ids?: Snowflake[]; roles?: Snowflake[] };
  roles: Role[];
  /** Channel/category overwrites. */
  overwrites?: PermissionOverwrite[];
}

/**
 * Computes a member's effective permissions using the same algorithm as the
 * web client: base role union, then @everyone, role and member overwrites.
 */
export function computePermissions(input: ComputePermissionsInput): bigint {
  const { userId, ownerId, member, roles, overwrites = [] } = input;
  if (ownerId && ownerId === userId) return ALL_PERMISSIONS;

  const everyone = roles.find((role) => role.is_everyone);
  let permissions = toBitfield(everyone?.permissions);

  const memberRoles = new Set(
    (member.role_ids ?? member.roles ?? []).map((id) => String(id)),
  );
  for (const role of roles) {
    if (role.is_everyone) continue;
    if (memberRoles.has(String(role.id))) permissions |= toBitfield(role.permissions);
  }

  if ((permissions & PermissionFlags.Administrator) !== 0n) return ALL_PERMISSIONS;

  const apply = (allow: BitfieldResolvable, deny: BitfieldResolvable) => {
    permissions = (permissions & ~toBitfield(deny)) | toBitfield(allow);
  };

  const everyoneOverwrite = overwrites.find(
    (overwrite) =>
      overwrite.role_id !== undefined &&
      String(overwrite.role_id) === String(everyone?.id),
  );
  if (everyoneOverwrite) apply(everyoneOverwrite.allow, everyoneOverwrite.deny);

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.role_id === undefined) continue;
    if (!memberRoles.has(String(overwrite.role_id))) continue;
    roleAllow |= toBitfield(overwrite.allow);
    roleDeny |= toBitfield(overwrite.deny);
  }
  if (roleAllow !== 0n || roleDeny !== 0n) apply(roleAllow, roleDeny);

  const memberOverwrite = overwrites.find(
    (overwrite) =>
      overwrite.user_id !== undefined && String(overwrite.user_id) === String(userId),
  );
  if (memberOverwrite) apply(memberOverwrite.allow, memberOverwrite.deny);

  return permissions;
}

/** Formats a bitfield for logging, e.g. `ViewChannel | SendMessages`. */
export function formatPermissions(permissions: BitfieldResolvable): string {
  const names = permissionNames(permissions);
  return names.length > 0 ? names.join(" | ") : "None";
}
