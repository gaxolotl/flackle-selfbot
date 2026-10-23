export interface APIErrorInit {
  status: number;
  method: string;
  path: string;
  code?: string;
  message?: string;
  body?: unknown;
  retryAfterMs?: number;
}

/** Base class for all library errors. */
export class FlackleError extends Error {
  override name = "FlackleError";
}

/** An HTTP request returned a non-2xx status. */
export class FlackleAPIError extends FlackleError {
  override name = "FlackleAPIError";
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly code?: string;
  readonly body?: unknown;
  readonly retryAfterMs?: number;

  constructor(init: APIErrorInit) {
    super(init.message ?? `Flackle API ${init.method} ${init.path} failed with ${init.status}`);
    this.status = init.status;
    this.method = init.method;
    this.path = init.path;
    this.code = init.code;
    this.body = init.body;
    this.retryAfterMs = init.retryAfterMs;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** The resource changed since it was fetched (stale version/ETag). */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /** The account must re-authenticate (step-up) before this action. */
  get requiresElevation(): boolean {
    return this.code === "elevation_required";
  }

  /** MFA must be enrolled before this action. */
  get requiresMfaEnrollment(): boolean {
    return this.code === "mfa_enrollment_required";
  }

  get accountRestricted(): boolean {
    return this.code === "account_restricted";
  }

  get accountPendingDeletion(): boolean {
    return this.code === "account_pending_deletion";
  }
}

/** Authentication failed, or no usable session is available. */
export class FlackleAuthError extends FlackleError {
  override name = "FlackleAuthError";
}

/** The gateway closed or could not be reached. */
export class FlackleGatewayError extends FlackleError {
  override name = "FlackleGatewayError";
  readonly code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.code = code;
  }
}
