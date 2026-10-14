import { createHash } from 'node:crypto';
import type { Clock } from '../shared/domain/clock';

interface Bucket {
  attempts: number;
  resetAt: number;
}

export class AuthLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly clock: Clock,
    private readonly windowMs: number,
    private readonly ipLimit: number,
    private readonly accountLimit: number,
  ) {}

  consume(ip: string, email: unknown): number | null {
    const now = this.clock.now().getTime();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
    const keys: Array<[string, number]> = [[`ip:${ip}`, this.ipLimit]];
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (normalizedEmail.length > 0 && normalizedEmail.length <= 254) {
      const digest = createHash('sha256').update(normalizedEmail).digest('hex');
      keys.push([`account:${digest}`, this.accountLimit]);
    }
    let retryAfter = 0;
    for (const [key, limit] of keys) {
      const bucket = this.buckets.get(key);
      if (bucket && bucket.attempts >= limit) retryAfter = Math.max(retryAfter, bucket.resetAt - now);
    }
    if (retryAfter > 0) return Math.ceil(retryAfter / 1000);
    for (const [key] of keys) {
      if (!this.buckets.has(key) && this.buckets.size >= 10000) {
        return Math.max(1, Math.ceil(this.windowMs / 1000));
      }
      const bucket = this.buckets.get(key) ?? { attempts: 0, resetAt: now + this.windowMs };
      bucket.attempts += 1;
      this.buckets.set(key, bucket);
    }
    return null;
  }
}
