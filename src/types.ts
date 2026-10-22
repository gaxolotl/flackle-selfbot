/**
 * Public payload types for the Flackle API.
 *
 * Flackle uses Discord-style snowflake IDs (decimal strings) for users,
 * servers, channels, messages and conversations, even though some internal
 * identifiers are UUIDs.
 */

export type Snowflake = string;

export type PresenceStatus = "online" | "idle" | "dnd" | "offline" | "invisible";

export type ChannelType = "text" | "voice" | "announcement" | "category" | "forum" | (string & {});

/** A user object as returned by `/api/auth/me`, friends, members and message senders. */
export interface User {
  id: Snowflake;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  status?: PresenceStatus;
  is_online?: boolean;
  typing_indicator_enabled?: boolean;
  typing_indicator_text?: string;
  typing_indicator_style?: string;
  typing_indicator_emojis?: string[];
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface PlanLimits {
  plan: string;
  max_upload_bytes: number;
  message_length: number;
  saved_budget_bytes: number;
  stream_fps: Record<string, number>;
  camera_resolution: string;
}

export interface Membership {
  plan: string;
}

export interface Billing {
  available: boolean;
  manage: boolean;
  lift_price_cents: number;
}

/** The authenticated account. */
export interface SelfUser extends User {
  email: string;
  is_admin: boolean;
  can_invite?: boolean;
  deletion_pending?: boolean;
  membership?: Membership;
  limits?: PlanLimits;
  beyond_limits?: PlanLimits;
  saved_storage?: { used: number; budget: number; count: number };
  lifts?: { lifts: unknown[] };
  billing?: Billing;
}

export interface Attachment {
  url: string;
  file_name?: string;
  file_size?: number;
  content_type?: string;
  width?: number;
  height?: number;
  saved?: boolean;
  [key: string]: unknown;
}

export interface MessageReply {
  id: Snowflake;
  content: string;
  sender_id: Snowflake;
  sender_username?: string;
  sender_display_name?: string;
  sender_avatar_url?: string;
  has_attachments?: boolean;
  deleted?: boolean;
}

export interface Reaction {
  emoji: string;
  count: number;
  me?: boolean;
  users?: User[];
}

/** Response from GET .../messages/:id/reactions/:emoji. */
export interface ReactionUsersPage {
  users: User[];
  total?: number;
  [key: string]: unknown;
}

export interface Embed {
  [key: string]: unknown;
}

/** A chat message, in both REST and gateway form. */
export interface Message {
  id: Snowflake;
  /** Present on DM messages; for guild messages this is the channel ID. */
  conversation_id?: Snowflake;
  content: string;
  type: "text" | "system" | (string & {});
  is_deleted: boolean;
  edited_at?: string;
  created_at: string;
  updated_at: string;
  nonce?: string;
  sender?: User;
  attachments?: Attachment[];
  embeds?: Embed[];
  reply_to?: MessageReply;
  reactions?: Reaction[];
  mention_ids?: Snowflake[];
  mention_everyone?: boolean;
  /** Client-side optimistic state. */
  isPending?: boolean;
  isFailed?: boolean;
  isEphemeral?: boolean;
}

export interface Server {
  id: Snowflake;
  name: string;
  icon_url?: string | null;
  banner_url?: string | null;
  default_notification_level?: string;
  owner_id?: Snowflake;
  visibility_status?: string;
  created_at?: string;
  updated_at?: string;
  approx_member_count?: number;
  approx_presence_count?: number;
  flags?: string;
}

export interface Channel {
  id: Snowflake;
  name: string;
  topic?: string | null;
  icon?: string | null;
  icon_color?: string | null;
  type: ChannelType;
  position?: number;
  slowmode_seconds?: number;
  permission_synced?: boolean;
  visibility_status?: string;
  metadata?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
  category_id?: Snowflake | null;
}

export interface Category {
  id: Snowflake;
  name: string;
  position?: number;
  created_at?: string;
}

export interface ChannelBundle {
  categories: Category[];
  channels: Channel[];
  permissions: Record<string, string>;
}

export interface ServerSettings {
  server_id: Snowflake;
  position?: number;
  last_viewed_channel_id?: Snowflake | null;
  notification_level?: string;
  collapsed_categories?: Snowflake[];
}

export interface ServerFolders {
  folders: unknown[];
  server_settings: ServerSettings[];
}

export interface UnreadChannel {
  server_id: Snowflake;
  channel_id: Snowflake;
  unread_count: number;
  mention_count: number;
  blocked_unread_count: number;
  blocked_mention_count: number;
}

export interface VoiceState {
  user_id: Snowflake;
  channel_id?: Snowflake;
  server_id?: Snowflake;
  self_mute?: boolean;
  self_deaf?: boolean;
  camera_on?: boolean;
  screen_sharing?: boolean;
  [key: string]: unknown;
}

export interface ConversationMember {
  role?: string;
  joined_at?: string;
  user: User;
}

export interface Conversation {
  id: Snowflake;
  type: "dm" | "group" | (string & {});
  name?: string | null;
  icon_url?: string | null;
  is_muted?: boolean;
  created_at?: string;
  updated_at?: string;
  last_message_at?: string | null;
  members?: ConversationMember[];
  last_message?: Message | null;
  unread_count?: number;
}

export interface FriendRequest {
  id: Snowflake;
  status: "pending" | (string & {});
  created_at: string;
  updated_at?: string;
  sender?: User;
  receiver?: User;
}

export interface FriendRequests {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

export interface Page<T> {
  has_more: boolean;
  has_more_after: boolean;
  has_more_before: boolean;
  messages: T[];
}

export interface BootstrapPayload {
  block_warning_dismissals: unknown[];
  conversation_calls: unknown[];
  conversations: Conversation[];
  me: SelfUser;
  servers: {
    folders: unknown[];
    server_settings: ServerSettings[];
    servers: Server[];
    unread_channels: UnreadChannel[];
    voice_states: Record<Snowflake, VoiceState[]>;
  };
  social: {
    blocked: User[];
    friends: User[];
  };
}

export interface SessionInfo {
  id: string;
  ip_address?: string;
  user_agent?: string;
  location?: string;
  created_at?: string;
  current?: boolean;
}

/* ------------------------------------------------------------------ */
/* Members, roles and permissions                                      */
/* ------------------------------------------------------------------ */

/** A role returned by `/api/servers/{id}/roles`. */
export interface Role {
  id: Snowflake;
  name: string;
  /** Decimal string bitfield of {@link PermissionFlags}. */
  permissions: string;
  position?: number;
  color?: string | null;
  hoist?: boolean;
  mentionable?: boolean;
  is_everyone?: boolean;
  icon_url?: string | null;
  icon_emoji?: string | null;
  member_count?: number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface RolesResponse {
  roles: Role[];
  /** False when the account may see role names but not their permission bits. */
  can_view_role_permissions?: boolean;
}

export interface Member {
  user: User;
  user_id?: Snowflake;
  nickname?: string | null;
  role_ids?: Snowflake[];
  roles?: Snowflake[];
  joined_at?: string;
  timed_out_until?: string | null;
  is_owner?: boolean;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface MemberPage {
  members: Member[];
  total?: number;
  [key: string]: unknown;
}

export interface ChannelMembers {
  member_ids: Snowflake[];
}

/** Identifies a channel or category for permission routes. */
export type PermissionTarget =
  | { channelId: Snowflake; categoryId?: never }
  | { categoryId: Snowflake; channelId?: never };

export interface TimeoutResult {
  timed_out_until?: string | null;
  [key: string]: unknown;
}

/** A single role or member overwrite on a channel/category. */
export interface PermissionOverwrite {
  role_id?: Snowflake;
  user_id?: Snowflake;
  /** Decimal string bitfield. */
  allow: string;
  deny: string;
  username?: string;
  [key: string]: unknown;
}

/** Response of `GET /api/servers/{id}/channels/{cid}/permissions`. */
export interface PermissionOverwritesResponse {
  role_overrides?: PermissionOverwrite[];
  user_overrides?: PermissionOverwrite[];
  category_role_overrides?: PermissionOverwrite[];
  category_user_overrides?: PermissionOverwrite[];
  version?: string;
  permission_synced?: boolean;
  [key: string]: unknown;
}

export interface PermissionOverwritesInput {
  version?: string;
  permission_synced?: boolean;
  role_overrides?: { role_id: Snowflake; allow: string; deny: string }[];
  user_overrides?: { user_id: Snowflake; allow: string; deny: string }[];
}

export interface ServerPermissionsResponse {
  permissions: string;
  [key: string]: unknown;
}

export interface RoleBatchUpdate {
  id: Snowflake | string;
  name?: string;
  permissions?: string;
  color?: string | null;
  hoist?: boolean;
  mentionable?: boolean;
  icon_emoji?: string | null;
  clear_icon?: boolean;
  upload_icon?: boolean;
  expected_updated_at?: string;
  [key: string]: unknown;
}

export interface RoleBatchCreate {
  /** Draft IDs (`draft:...`) are mapped to real IDs in the response. */
  id?: string;
  name: string;
  permissions?: string;
  color?: string | null;
  hoist?: boolean;
  mentionable?: boolean;
  icon_emoji?: string | null;
  [key: string]: unknown;
}

export interface RoleBatchDelete {
  id: Snowflake;
  expected_updated_at?: string;
}

export interface RoleBatchPayload {
  updates?: RoleBatchUpdate[];
  creates?: RoleBatchCreate[];
  deletes?: RoleBatchDelete[];
  /** Role IDs from highest to lowest. */
  order?: Snowflake[];
}

export interface RoleBatchResponse {
  roles?: Role[];
  created_role_ids?: Record<string, Snowflake>;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Invites, bans, audit log                                            */
/* ------------------------------------------------------------------ */

export interface Invite {
  code: string;
  max_uses?: number | null;
  uses?: number;
  grants_root?: boolean;
  expires_at?: string | null;
  created_at?: string;
  [key: string]: unknown;
}

export interface InviteAccess {
  is_admin?: boolean;
  quota?: number;
  reserved?: number;
  invites_paused?: boolean;
  [key: string]: unknown;
}

export interface GlobalInvites {
  access: InviteAccess;
  invites: Invite[];
  joined?: unknown[];
  [key: string]: unknown;
}

export interface ServerInvite extends Invite {
  server_id?: Snowflake;
  channel_id?: Snowflake | null;
  inviter?: User;
  server?: Server;
}

export interface InvitePreview {
  server?: Server;
  channel?: Channel;
  inviter?: User;
  [key: string]: unknown;
}

export interface ServerBan {
  user_id: Snowflake;
  user?: User;
  reason?: string | null;
  moderator_id?: Snowflake;
  created_at?: string;
  [key: string]: unknown;
}

export interface AuditLogEntry {
  id: string;
  action_type: string;
  actor_id?: Snowflake;
  target_id?: Snowflake;
  changes?: unknown[];
  options?: Record<string, unknown>;
  created_at?: string;
  [key: string]: unknown;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  has_more?: boolean;
  [key: string]: unknown;
}

export interface AuditLogOptions {
  limit?: number;
  before?: string;
  actionTypes?: string[];
  actorIds?: Snowflake[];
  targetIds?: Snowflake[];
}

/* ------------------------------------------------------------------ */
/* Message extras                                                      */
/* ------------------------------------------------------------------ */

export interface MessageSearchOptions {
  /** Search text. `query` is an alias for `q`. */
  q?: string;
  query?: string;
  limit?: number;
  offset?: number;
  before?: Snowflake;
  after?: Snowflake;
  author_id?: Snowflake;
  pinned?: boolean;
  [key: string]: unknown;
}

export interface MessageSearchPage {
  messages: Message[];
  incomplete?: boolean;
  scanned?: number;
  next_before?: string;
  [key: string]: unknown;
}

export interface ConversationMessagesByIds {
  conversations: Record<
    Snowflake,
    {
      messages: Message[];
      has_more?: boolean;
      has_more_before?: boolean;
      has_more_after?: boolean;
      [key: string]: unknown;
    }
  >;
}

export interface BulkDeleteResult {
  deleted?: number;
  [key: string]: unknown;
}

export interface LatestMessageIdResponse {
  latest_message_id?: Snowflake | null;
}

export interface SavedMediaItem {
  url: string;
  file_name?: string;
  file_size?: number;
  content_type?: string;
  expires_at?: string | null;
  saved_at?: string;
  [key: string]: unknown;
}

export interface SavedMediaPage {
  items: SavedMediaItem[];
  count: number;
  next_cursor?: string | null;
  used?: number;
  budget?: number;
  first_grace_ends_at?: string;
  [key: string]: unknown;
}

export interface MediaStorageSnapshot {
  used?: number;
  budget?: number;
  count?: number;
  saved_by_me?: boolean;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Profiles, bento, blocks                                             */
/* ------------------------------------------------------------------ */

export interface BlockEntry {
  id?: string;
  type: string;
  url?: string;
  title?: string;
  content?: string;
  image_url?: string;
  position?: number;
  [key: string]: unknown;
}

export interface BentoCard {
  id?: string;
  type: string;
  [key: string]: unknown;
}

export interface UserCard {
  user: User;
  membership?: Membership;
  badges?: unknown[];
  socials?: unknown[];
  blocks?: BlockEntry[];
  member?: Member;
  [key: string]: unknown;
}

export interface BentoResponse {
  cards: BentoCard[];
  [key: string]: unknown;
}

export interface BlocksResponse {
  blocks: BlockEntry[];
  [key: string]: unknown;
}

export interface TypingIndicatorSettings {
  enabled: boolean;
  text?: string;
  style?: "text" | "emojis" | (string & {});
  emojis?: string[];
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Account security                                                    */
/* ------------------------------------------------------------------ */

export interface TwoFactorStatus {
  enabled: boolean;
  [key: string]: unknown;
}

export interface TwoFactorSetup {
  secret: string;
  otpauth_url?: string;
  qr_code?: string;
  [key: string]: unknown;
}

export interface BackupCodes {
  codes: string[];
  [key: string]: unknown;
}

export interface SecurityEvent {
  id: string;
  type: string;
  created_at?: string;
  ip_address?: string;
  user_agent?: string;
  [key: string]: unknown;
}

export interface GdprRequest {
  type: "data" | "delete" | (string & {});
  status?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface BillingSession {
  url?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Server/channel/conversation management                              */
/* ------------------------------------------------------------------ */

export interface CreateServerResult {
  server: Server;
  channel: Channel;
}

export interface CreateChannelOptions {
  name: string;
  type?: ChannelType;
  category_id?: Snowflake | null;
  topic?: string | null;
  slowmode_seconds?: number;
}

export interface ChannelUpdate {
  name?: string;
  topic?: string | null;
  slowmode_seconds?: number;
  category_id?: Snowflake | null;
  position?: number;
  icon_color?: string | null;
  visibility_status?: string;
  metadata?: Record<string, unknown> | null;
}

export interface CategoryUpdate {
  name?: string;
  position?: number;
}

export interface ServerUpdate {
  name?: string;
  description?: string | null;
  default_notification_level?: "all" | "mentions" | "nothing";
}

export interface ChannelPositionUpdate {
  id: Snowflake;
  position: number;
  category_id?: Snowflake | null;
}

export interface CategoryPositionUpdate {
  id: Snowflake;
  position: number;
}

export interface ServerPositionUpdate {
  server_id: Snowflake;
  position: number;
  folder_id?: string | null;
  clear_folder?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  color?: string;
  position?: number;
  [key: string]: unknown;
}

export interface ChannelSettings {
  channel_id: Snowflake;
  notification_level?: string;
  muted_until?: string | null;
}

export interface ChannelSettingsPatch {
  notification_level?: string;
  muted_until?: string | null;
  clear_muted_until?: boolean;
}

export interface ServerUserSettings {
  server_id?: Snowflake;
  notification_level?: string;
  muted_until?: string | null;
  last_viewed_channel_id?: Snowflake | null;
  collapsed_categories?: Snowflake[];
  [key: string]: unknown;
}

export interface ConversationUpdate {
  name?: string | null;
  icon_url?: string | null;
}

export interface ReportInput {
  report_type: "user" | "message";
  category: string;
  subcategory?: string;
  additional_info?: string;
  is_ongoing_issue?: boolean;
  is_immediate_danger?: boolean;
  reported_user_id?: Snowflake;
  reported_message_id?: Snowflake;
  reported_channel_id?: Snowflake;
  reported_conversation_id?: Snowflake;
}

export interface ServerTransferInput {
  new_owner_user_id: Snowflake;
  confirm_name: string;
  password: string;
}

export interface SupporterRoleResponse {
  role_id?: Snowflake | null;
  [key: string]: unknown;
}

export interface Game {
  id: string;
  title: string;
  [key: string]: unknown;
}

export interface ServerVoiceStatesResponse {
  voice_states?: VoiceState[];
  [key: string]: unknown;
}

export interface ConversationVoiceState {
  participants?: unknown[];
  ringing?: unknown[];
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Gateway                                                             */
/* ------------------------------------------------------------------ */

export interface HelloPayload {
  v: number;
  session_id: string;
  presences: Record<Snowflake, PresenceStatus>;
}

export interface GatewayMessageCreate {
  message: Message;
  serverId?: Snowflake;
  channelId?: Snowflake;
  conversationId?: Snowflake;
}

export interface GatewayMessageUpdate {
  message: Partial<Message> & { id: Snowflake };
  serverId?: Snowflake;
  channelId?: Snowflake;
  conversationId?: Snowflake;
}

export interface GatewayMessageDelete {
  id: Snowflake;
  serverId?: Snowflake;
  channelId?: Snowflake;
  conversationId?: Snowflake;
  message?: Message;
}

export interface GatewayTyping {
  userId: Snowflake;
  serverId?: Snowflake;
  channelId?: Snowflake;
  conversationId?: Snowflake;
  isTyping: boolean;
}

export interface GatewayReaction {
  messageId: Snowflake;
  emoji: string;
  count: number;
  userId?: Snowflake;
  user?: User;
  serverId?: Snowflake;
  channelId?: Snowflake;
  conversationId?: Snowflake;
  message?: Message;
}

export interface GatewayMessageAck {
  nonce: string;
  status: "sent" | "edit_ok" | "delete_ok" | "slowmode" | "timeout" | "not_friends" | "pending_deletion" | (string & {});
  messageId?: Snowflake;
  embeds?: Embed[];
  attachments?: Attachment[];
  retryAfter?: number;
  error?: string;
}

export interface GatewayBulkMessageDelete {
  ids: Snowflake[];
  serverId: Snowflake;
  channelId: Snowflake;
}

export interface GatewayPresence {
  userId: Snowflake;
  status: PresenceStatus;
}

export interface GatewayReady extends HelloPayload {
  user?: SelfUser;
}

/** Normalised events emitted by {@link Gateway}. */
export interface GatewayEvents {
  /** Emitted for every successfully parsed gateway frame, using the raw snake_case type. */
  raw: { type: string; payload: any };
  /** Emitted once the `hello` frame arrives. */
  ready: GatewayReady;
  connected: void;
  disconnected: { code: number; reason: string };
  resumed: unknown;
  messageCreate: GatewayMessageCreate;
  messageUpdate: GatewayMessageUpdate;
  messageDelete: GatewayMessageDelete;
  messagesBulkDelete: GatewayBulkMessageDelete;
  messageAck: GatewayMessageAck;
  typingStart: GatewayTyping;
  typingStop: GatewayTyping;
  reactionAdd: GatewayReaction;
  reactionRemove: GatewayReaction;
  presenceUpdate: GatewayPresence;
  channelCreate: unknown;
  channelUpdate: unknown;
  channelDelete: unknown;
  conversationCreate: unknown;
  conversationUpdate: unknown;
  conversationDelete: unknown;
  friendRequestReceived: unknown;
  friendRequestAccepted: unknown;
  friendAdd: unknown;
  friendRemove: unknown;
  guildMemberAdd: unknown;
  guildMemberRemove: unknown;
  accountRestricted: unknown;
  error: Error;
}

export type GatewayEventName = keyof GatewayEvents;
export type GatewayEvent<K extends GatewayEventName> = GatewayEvents[K];

/* ------------------------------------------------------------------ */
/* REST helpers                                                        */
/* ------------------------------------------------------------------ */

export interface UploadInit {
  id: string;
  part_size: number;
  urls: string[];
}

export interface UploadComplete {
  attachment: Attachment;
}

export interface SendMessageOptions {
  attachments?: Attachment[];
  replyToMessageId?: Snowflake;
  nonce?: string;
}

export interface FetchMessagesOptions {
  limit?: number;
  before?: Snowflake;
  after?: Snowflake;
  around?: Snowflake;
}

export type MessageTarget =
  | { serverId: Snowflake; channelId: Snowflake; conversationId?: never }
  | { conversationId: Snowflake; serverId?: never; channelId?: never };

export interface LoginOptions {
  email: string;
  password: string;
  /** Called when the account has MFA enabled. Return a TOTP code or a backup code. */
  mfa?: (challenge: { mfaToken: string; methods?: string[] }) => string | Promise<string>;
  /** Force the MFA response to be treated as a backup code. */
  backupCode?: boolean;
}

export interface ClientOptions {
  /** Base URL of the Flackle web app. */
  baseUrl?: string;
  /** User-Agent sent with REST and gateway requests. */
  userAgent?: string;
  /** Minimum delay between REST requests, in milliseconds. */
  requestIntervalMs?: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** How many times to retry 429/5xx responses. */
  maxRetries?: number;
  /** Automatically reconnect the gateway after an unexpected close. */
  autoReconnect?: boolean;
  /** WebSocket heartbeat interval. */
  heartbeatIntervalMs?: number;
  /** Reconnect at most this many times in a row. */
  maxReconnectAttempts?: number;
  /** Existing session tokens, to skip {@link FlackleClient.login}. */
  accessToken?: string;
  refreshToken?: string;
  /** Seed the CSRF cookie if you already have one. */
  csrfToken?: string;
}
