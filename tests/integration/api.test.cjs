const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { before, after, test } = require('node:test');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApplication } = require('../../apps/api/dist/bootstrap/application');
const { loadConfig } = require('../../apps/api/dist/bootstrap/config');
const { JsonLogger } = require('../../apps/api/dist/bootstrap/json-logger');

const password = 'contraseña-segura-123';
const secret = 'integration-test-secret-with-at-least-32-characters';
const clock = { now: () => new Date('2026-10-14T16:00:00.000Z') };
const logs = [];
let mongo;
let application;
let api;

function config(overrides = {}) {
  return loadConfig({
    MONGODB_URI: mongo.getUri(),
    MONGODB_DATABASE: `test_${randomUUID().replaceAll('-', '')}`,
    JWT_SECRET: secret,
    RATE_PROVIDER_MODE: 'fixture',
    AUTH_RATE_IP_LIMIT: '1000',
    AUTH_RATE_ACCOUNT_LIMIT: '1000',
    ...overrides,
  });
}

async function user(client = api) {
  const email = `persona-${randomUUID()}@example.com`;
  const registered = await client.post('/v1/auth/register').send({ nombre: 'Ana Pérez', email, password });
  assert.equal(registered.status, 201);
  const login = await client.post('/v1/auth/login').send({ email, password });
  assert.equal(login.status, 200);
  return { ...login.body.usuario, token: login.body.access_token, email };
}

function history(client, actor, query = {}) {
  return client.get('/v1/transactions/history').auth(actor.token, { type: 'bearer' }).query({ startDate: '2026-10-14', endDate: '2026-10-14', ...query });
}

before(async () => {
  mongo = await MongoMemoryServer.create({ binary: { version: '8.0.16', downloadDir: path.resolve('.runtime/mongodb-binaries') }, instance: { ip: '127.0.0.1' } });
  application = await createApplication(config(), { clock, startScheduler: false, logger: new JsonLogger((line) => logs.push(JSON.parse(line))) });
  await application.app.listen(0, '127.0.0.1');
  api = request(application.app.getHttpServer());
});

after(async () => {
  if (application) await application.app.close();
  if (mongo) await mongo.stop();
});

test('registro fuerza rol user, normaliza email y nunca devuelve credenciales', async () => {
  const email = `NUEVA-${randomUUID()}@EXAMPLE.COM`;
  const response = await api.post('/v1/auth/register').send({ nombre: ' Ana Pérez ', email: ` ${email} `, password, rol: 'admin', passwordHash: 'injected' });
  assert.equal(response.status, 201);
  assert.deepEqual(Object.keys(response.body).sort(), ['email', 'id', 'nombre', 'rol']);
  assert.equal(response.body.rol, 'user');
  assert.equal(response.body.email, email.toLowerCase());
  const stored = await application.db.collection('users').findOne({ _id: new ObjectId(response.body.id) });
  assert.ok(stored.passwordHash.startsWith('$argon2id$'));
  assert.notEqual(stored.passwordHash, password);
  const duplicate = await api.post('/v1/auth/register').send({ nombre: 'Otra persona', email: email.toLowerCase(), password });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'EMAIL_ALREADY_EXISTS');
});

test('login entrega el contrato exacto y rechaza credenciales incorrectas', async () => {
  const actor = await user();
  const response = await api.post('/v1/auth/login').send({ email: actor.email, password });
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ['access_token', 'usuario']);
  assert.equal(jwt.decode(response.body.access_token).exp - jwt.decode(response.body.access_token).iat, 900);
  const wrong = await api.post('/v1/auth/login').send({ email: actor.email, password: 'incorrecta' });
  const missing = await api.post('/v1/auth/login').send({ email: `missing-${randomUUID()}@example.com`, password });
  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(wrong.body.message, missing.body.message);
});

test('negocio requiere firma, exp, emisor y audiencia válidos', async () => {
  const actor = await user();
  const now = Math.floor(clock.now().getTime() / 1000);
  const base = { sub: actor.id, iss: 'exchange-api', aud: 'exchange-web' };
  const invalid = [
    'invalid-token',
    jwt.sign({ ...base, exp: now - 1 }, secret),
    jwt.sign(base, secret),
    jwt.sign({ ...base, exp: now + 60, iss: 'another-api' }, secret),
    jwt.sign({ ...base, exp: now + 60, aud: 'another-web' }, secret),
    jwt.sign({ ...base, exp: now + 60 }, 'another-secret-at-least-32-characters'),
  ];
  assert.equal((await api.post('/v1/transactions').send({})).status, 401);
  for (const token of invalid) {
    const response = await api.get('/v1/transactions/history').auth(token, { type: 'bearer' }).query({ startDate: '2026-10-14', endDate: '2026-10-14' });
    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'UNAUTHORIZED');
  }
});

test('sin tasa registrada se informa indisponibilidad y no se crea solicitud', async () => {
  const actor = await user();
  await application.db.collection('exchange_rates').deleteMany({});
  const response = await api.post('/v1/transactions').auth(actor.token, { type: 'bearer' }).send({ monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'EXCHANGE_RATE_UNAVAILABLE');
  assert.equal(await application.db.collection('transactions').countDocuments({ userId: actor.id }), 0);
  await application.services.syncRates.execute();
});

test('ambas conversiones responden el valor registrado y el snapshot histórico permanece estable', async () => {
  const actor = await user();
  const usd = await api.post('/v1/transactions').auth(actor.token, { type: 'bearer' }).send({ monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
  const pen = await api.post('/v1/transactions').auth(actor.token, { type: 'bearer' }).send({ monedaOrigen: 'PEN', monedaDestino: 'USD', monto: 100 });
  assert.equal(usd.status, 201);
  assert.equal(pen.status, 201);
  assert.equal(usd.body.montoCambiado, 373.9);
  assert.equal(usd.body.tipoCambio, 3.739);
  assert.equal(pen.body.montoCambiado, 26.79);
  assert.equal(pen.body.tipoCambio, 3.733);
  assert.deepEqual(Object.keys(usd.body).sort(), ['fecha', 'id', 'monedaDestino', 'monedaOrigen', 'monto', 'montoCambiado', 'tipoCambio']);
  await application.services.rates.save({ compra: '5', venta: '6', origen: 'SUNAT', moneda: 'USD', providerDate: '2026-10-14', fetchedAt: new Date('2026-10-14T17:00:00Z') });
  const response = await history(api, actor);
  assert.equal(response.status, 200);
  assert.equal(response.body.find((row) => row.id === usd.body.id).tipoCambio, 3.739);
  assert.equal(response.body.find((row) => row.id === pen.body.id).montoCambiado, 26.79);
});

test('API aplica límites monetarios y par válido aunque se omita el frontend', async () => {
  const actor = await user();
  for (const body of [
    { monedaOrigen: 'USD', monedaDestino: 'USD', monto: 100 },
    { monedaOrigen: 'EUR', monedaDestino: 'PEN', monto: 100 },
    { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 0 },
    { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: -1 },
    { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 1.001 },
    { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 10000000 },
    { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: '100' },
  ]) {
    const response = await api.post('/v1/transactions').auth(actor.token, { type: 'bearer' }).send(body);
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'VALIDATION_ERROR');
  }
  const maximum = await api.post('/v1/transactions').auth(actor.token, { type: 'bearer' }).send({ monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 9999999.99 });
  assert.equal(maximum.status, 201);
  assert.ok(maximum.body.montoCambiado > 9999999.99);
});

test('user ignora userId y admin consulta el historial autorizado con rol vigente', async () => {
  const first = await user();
  const second = await user();
  for (const actor of [first, second]) {
    const response = await api.post('/v1/transactions').auth(actor.token, { type: 'bearer' }).send({ monedaOrigen: 'USD', monedaDestino: 'PEN', monto: actor === first ? 11 : 22 });
    assert.equal(response.status, 201);
  }
  for (const userId of [second.id, 'invalid-id', { nested: 'value' }]) {
    const response = await history(api, first, { userId });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.map((row) => row.monto), [11]);
  }
  await application.db.collection('users').updateOne({ _id: new ObjectId(first.id) }, { $set: { rol: 'admin' } });
  assert.deepEqual((await history(api, first, { userId: second.id })).body.map((row) => row.monto), [22]);
  assert.deepEqual((await history(api, first)).body.map((row) => row.monto), [11]);
  assert.equal((await history(api, first, { userId: 'invalid-id' })).status, 400);
  await application.db.collection('users').updateOne({ _id: new ObjectId(first.id) }, { $set: { rol: 'user' } });
  assert.deepEqual((await history(api, first, { userId: second.id })).body.map((row) => row.monto), [11]);
});

test('historial exige fechas válidas y devuelve array vacío en rango sin solicitudes', async () => {
  const actor = await user();
  const invalid = [{ startDate: undefined }, { endDate: undefined }, { startDate: '2026-02-30' }, { startDate: '2026-10-15' }];
  for (const query of invalid) assert.equal((await history(api, actor, query)).status, 400);
  const empty = await history(api, actor, { startDate: '2026-10-01', endDate: '2026-10-02' });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, []);
});

test('un usuario eliminado o con rol desconocido ya no puede operar', async () => {
  const actor = await user();
  await application.db.collection('users').updateOne({ _id: new ObjectId(actor.id) }, { $set: { rol: 'owner' } });
  assert.equal((await history(api, actor)).status, 401);
  await application.db.collection('users').deleteOne({ _id: new ObjectId(actor.id) });
  assert.equal((await history(api, actor)).status, 401);
});

test('rate limiting responde 429 y Retry-After, y recupera al terminar la ventana', async () => {
  let now = clock.now();
  const limited = await createApplication(config({ AUTH_RATE_IP_LIMIT: '3', AUTH_RATE_ACCOUNT_LIMIT: '2', AUTH_RATE_WINDOW_MS: '1000' }), {
    clock: { now: () => now }, startScheduler: false, logger: new JsonLogger(() => {}),
  });
  try {
    await limited.app.listen(0, '127.0.0.1');
    const client = request(limited.app.getHttpServer());
    const body = { email: 'missing@example.com', password };
    assert.equal((await client.post('/v1/auth/login').send(body)).status, 401);
    assert.equal((await client.post('/v1/auth/login').send(body)).status, 401);
    const blocked = await client.post('/v1/auth/login').send(body);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers['retry-after'], '1');
    now = new Date(now.getTime() + 1000);
    assert.equal((await client.post('/v1/auth/login').send(body)).status, 401);
  } finally {
    await limited.app.close();
  }
});

test('OpenAPI documenta Bearer y rutas sin exponer usuarios ni secretos', async () => {
  const response = await api.get('/api-json');
  assert.equal(response.status, 200);
  assert.ok(response.body.paths['/v1/auth/register']);
  assert.ok(response.body.paths['/v1/transactions']);
  assert.ok(response.body.paths['/v1/transactions/history']);
  assert.equal(response.body.components.securitySchemes.bearer.scheme, 'bearer');
  assert.ok(!JSON.stringify(response.body).includes(secret));
});

test('respuestas y logs tienen correlación y no registran credenciales', async () => {
  const response = await api.get('/v1/transactions/history').set('X-Request-Id', 'trace-safe-123');
  assert.equal(response.status, 401);
  assert.equal(response.body.requestId, 'trace-safe-123');
  assert.equal(response.headers['x-request-id'], 'trace-safe-123');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.ok(logs.some((entry) => entry.event === 'http_request' && entry.requestId === 'trace-safe-123'));
  const text = JSON.stringify(logs);
  assert.ok(!text.includes(password));
  assert.ok(!text.includes(secret));
  assert.ok(!text.includes('$argon2id$'));
});
