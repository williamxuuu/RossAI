import { NextResponse } from "next/server";

/**
 * In-memory token bucket rate limiter for the public extension endpoints.
 *
 * Each limiter owns its own bucket map, so `explain` (30/min) and `escalate`
 * (10/min) never share tokens. State lives in process memory: on Cloud Run this
 * means "per instance", which is the intended MVP scope (docs/research/chrome-ext:
 * public endpoint + payload caps + per-IP rate limiting).
 */

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSec: number };

export type RateLimiter = {
  readonly name: string;
  /** Consume one token for `key`. `now` is injectable for tests. */
  take(key: string, now?: number): RateLimitResult;
  /** Drop every bucket (tests). */
  reset(): void;
  /** Number of tracked keys (tests / diagnostics). */
  size(): number;
};

type Bucket = { tokens: number; updatedAt: number };

const MAX_TRACKED_KEYS = 10_000;

export function createRateLimiter(opts: { name: string; capacity: number; windowMs: number }): RateLimiter {
  const { name, capacity, windowMs } = opts;
  if (capacity < 1 || windowMs <= 0) throw new Error("rate limiter needs capacity >= 1 and windowMs > 0");
  const refillPerMs = capacity / windowMs;
  const buckets = new Map<string, Bucket>();
  let lastPrune = 0;

  function refill(b: Bucket, now: number): void {
    const elapsed = Math.max(0, now - b.updatedAt);
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
    b.updatedAt = now;
  }

  /** Drop buckets that are full again (idle for at least one window) so memory stays bounded. */
  function prune(now: number): void {
    if (now - lastPrune < windowMs && buckets.size < MAX_TRACKED_KEYS) return;
    lastPrune = now;
    for (const [key, b] of buckets) {
      refill(b, now);
      if (b.tokens >= capacity) buckets.delete(key);
    }
  }

  return {
    name,
    take(key, now = Date.now()) {
      prune(now);
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: capacity, updatedAt: now };
        buckets.set(key, b);
      } else {
        refill(b, now);
      }
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true, remaining: Math.floor(b.tokens) };
      }
      const msUntilToken = (1 - b.tokens) / refillPerMs;
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil(msUntilToken / 1000)) };
    },
    reset() {
      buckets.clear();
    },
    size() {
      return buckets.size;
    },
  };
}

/**
 * Rate-limit key for a request: the client IP as seen through Cloud Run's proxy
 * (`x-forwarded-for` first hop), then `x-real-ip`, else a shared "anonymous" bucket.
 */
export function requestKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "anonymous";
}

/** 429 JSON response for a failed `take()`. */
export function rateLimitResponse(result: { ok: false; retryAfterSec: number }): NextResponse {
  return NextResponse.json(
    { error: "rate_limited", message: "Too many requests. Please wait a moment and try again.", retryAfterSec: result.retryAfterSec },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSec) } },
  );
}
