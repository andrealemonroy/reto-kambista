import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthLimiter } from '../src/bootstrap/auth-limiter';
import { authenticationIp, AuthenticationLimitGuard, type ActorRequest } from '../src/bootstrap/http-security';

function request(headers: ActorRequest['headers'] = {}, ip: string | undefined = '10.0.0.1'): ActorRequest {
  return { headers, ip, socket: { remoteAddress: '10.0.0.2' }, body: {} } as ActorRequest;
}

function context(input: ActorRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => input, getResponse: () => ({ setHeader: vi.fn() }) }),
  } as unknown as ExecutionContext;
}

beforeEach(() => {
  vi.stubEnv('RENDER', 'false');
  vi.stubEnv('RENDER_SERVICE_TYPE', 'web');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authentication client IP', () => {
  it('keeps distinct Render clients in distinct IP buckets', () => {
    vi.stubEnv('RENDER', 'true');
    const limiter = new AuthLimiter({ now: () => new Date(0) }, 60000, 1, 100);
    const guard = new AuthenticationLimitGuard(limiter);
    const first = context(request({ 'cf-connecting-ip': '203.0.113.1' }));
    const second = context(request({ 'cf-connecting-ip': '203.0.113.2' }));

    expect(guard.canActivate(first)).toBe(true);
    expect(guard.canActivate(second)).toBe(true);
    expect(() => guard.canActivate(first)).toThrow(expect.objectContaining({ code: 'REQUEST_LIMIT_EXCEEDED' }));
  });

  it.each([
    { RENDER: 'false', RENDER_SERVICE_TYPE: 'web' },
    { RENDER: undefined, RENDER_SERVICE_TYPE: 'web' },
    { RENDER: 'true', RENDER_SERVICE_TYPE: 'pserv' },
    { RENDER: 'true', RENDER_SERVICE_TYPE: undefined },
  ])('ignores client headers outside a public Render web service: %j', (env) => {
    expect(authenticationIp(request({ 'cf-connecting-ip': '203.0.113.1' }), env)).toBe('10.0.0.1');
  });

  it.each([undefined, '', 'unknown', '203.0.113.1, 203.0.113.2', ['203.0.113.1'], '203.0.113.1:8080'])(
    'falls back when the Render client header is missing or invalid: %j', (header) => {
      expect(authenticationIp(request({ 'cf-connecting-ip': header }), { RENDER: 'true', RENDER_SERVICE_TYPE: 'web' }))
        .toBe('10.0.0.1');
    });

  it('accepts a scalar IPv6 client address from Render', () => {
    expect(authenticationIp(request({ 'cf-connecting-ip': '2001:db8::1' }), { RENDER: 'true', RENDER_SERVICE_TYPE: 'web' }))
      .toBe('2001:db8::1');
  });

  it('ignores X-Forwarded-For both with and without a valid Render client header', () => {
    const env = { RENDER: 'true', RENDER_SERVICE_TYPE: 'web' };
    expect(authenticationIp(request({ 'x-forwarded-for': '203.0.113.99' }), env)).toBe('10.0.0.1');
    expect(authenticationIp(request({ 'cf-connecting-ip': '203.0.113.1', 'x-forwarded-for': '203.0.113.99' }), env))
      .toBe('203.0.113.1');
  });

  it('keeps the same local IP bucket despite forged client headers', () => {
    const limiter = new AuthLimiter({ now: () => new Date(0) }, 60000, 1, 100);
    const guard = new AuthenticationLimitGuard(limiter);

    expect(guard.canActivate(context(request({ 'cf-connecting-ip': '203.0.113.1' })))).toBe(true);
    expect(() => guard.canActivate(context(request({ 'cf-connecting-ip': '203.0.113.2' }))))
      .toThrow(expect.objectContaining({ code: 'REQUEST_LIMIT_EXCEEDED' }));
  });

  it('uses the socket address when Express has no IP', () => {
    const input = request();
    Object.defineProperty(input, 'ip', { value: undefined });
    expect(authenticationIp(input)).toBe('10.0.0.2');
  });
});
