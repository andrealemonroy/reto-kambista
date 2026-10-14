const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { after, before, beforeEach, describe, it } = require('node:test');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient, ObjectId } = require('mongodb');
const { Email } = require('../../apps/api/dist/modules/identity/domain/user.js');
const { MongoUserRepository } = require('../../apps/api/dist/modules/identity/infrastructure/mongo-user.repository.js');
const { MongoExchangeRateRepository } = require('../../apps/api/dist/modules/rates/infrastructure/mongo-exchange-rate.repository.js');
const { MongoTransactionRepository } = require('../../apps/api/dist/modules/transactions/infrastructure/mongo-transaction-repository.js');
const { CreateTransaction } = require('../../apps/api/dist/modules/transactions/application/create-transaction.js');
const { GetTransactionHistory } = require('../../apps/api/dist/modules/transactions/application/get-transaction-history.js');

describe('Mongo repository contracts', { concurrency: false }, () => {
  let server;
  let client;
  let db;
  let users;
  let rates;
  let transactions;

  before(async () => {
    const databaseName = `repository_${randomUUID().replaceAll('-', '')}`;
    server = await MongoMemoryServer.create({
      binary: {
        version: '8.0.16',
        downloadDir: path.resolve('.runtime/mongodb-binaries'),
      },
      instance: { dbName: databaseName },
    });
    client = new MongoClient(server.getUri());
    await client.connect();
    db = client.db(databaseName);
    users = new MongoUserRepository(db);
    rates = new MongoExchangeRateRepository(db);
    transactions = new MongoTransactionRepository(db);
    await Promise.all([
      users.ensureIndexes(),
      rates.ensureIndexes(),
      transactions.ensureIndexes(),
    ]);
  }, { timeout: 120_000 });

  beforeEach(async () => {
    await Promise.all([
      db.collection('users').deleteMany({}),
      db.collection('exchange_rates').deleteMany({}),
      db.collection('transactions').deleteMany({}),
    ]);
  });

  after(async () => {
    await client?.close();
    await server?.stop();
  });

  function capture(fetchedAt, overrides = {}) {
    return rates.save({
      compra: '3.733',
      venta: '3.739',
      origen: 'SUNAT',
      moneda: 'USD',
      providerDate: '2024-01-18',
      fetchedAt: new Date(fetchedAt),
      ...overrides,
    });
  }

  it('enforces normalized email uniqueness during concurrent registrations', async () => {
    const attempts = Array.from({ length: 8 }, (_, index) => users.create({
      nombre: `Usuario ${index}`,
      email: Email.normalize(index % 2 ? ' SHARED@example.com ' : 'shared@EXAMPLE.com'),
      passwordHash: `stored-hash-${index}`,
      rol: 'user',
      createdAt: new Date('2026-10-14T15:00:00.000Z'),
    }));
    const results = await Promise.allSettled(attempts);
    const successful = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(successful.length, 1);
    assert.equal(rejected.length, 7);
    for (const result of rejected) {
      assert.equal(result.reason.code, 'EMAIL_ALREADY_EXISTS');
    }
    assert.equal(await db.collection('users').countDocuments({}), 1);
    const persisted = await db.collection('users').findOne({ email: 'shared@example.com' });
    assert.ok(persisted._id instanceof ObjectId);
    assert.ok(persisted.createdAt instanceof Date);
    assert.equal(persisted.rol, 'user');
    assert.equal(persisted.passwordHash, successful[0].value.passwordHash);
    const indexes = await db.collection('users').listIndexes().toArray();
    const uniqueEmail = indexes.find((index) => index.name === 'unique_email');
    assert.deepEqual(uniqueEmail.key, { email: 1 });
    assert.equal(uniqueEmail.unique, true);
    await users.ensureIndexes();
    assert.equal((await users.findByEmail('shared@example.com')).id, successful[0].value.id);
    assert.equal((await users.findById(successful[0].value.id)).email, 'shared@example.com');
  });

  it('stores decimal snapshots independently and finds the latest capture instead of the latest insert', async () => {
    await assert.doesNotReject(() => rates.ensureIndexes());
    assert.equal(await rates.latest(), null);
    const first = await capture('2026-10-14T15:00:00.000Z');
    const olderInsertedLater = await capture('2026-10-14T14:59:30.000Z', { venta: '3.700' });
    assert.equal((await rates.latest()).id, first.id);
    const repeated = await capture('2026-10-14T15:00:30.000Z');
    const tied = await capture('2026-10-14T15:00:30.000Z');

    assert.notEqual(repeated.id, first.id);
    assert.notEqual(tied.id, repeated.id);
    assert.equal(await db.collection('exchange_rates').countDocuments({}), 4);
    assert.equal((await rates.latest()).id, tied.id);
    assert.equal((await rates.latest()).compra, '3.733');
    assert.equal((await rates.latest()).venta, '3.739');
    const types = await db.collection('exchange_rates').aggregate([
      { $match: { _id: new ObjectId(first.id) } },
      { $project: { _id: 0, compra: { $type: '$compra' }, venta: { $type: '$venta' }, fetchedAt: { $type: '$fetchedAt' } } },
    ]).toArray();
    assert.deepEqual(types, [{ compra: 'decimal', venta: 'decimal', fetchedAt: 'date' }]);
    const preserved = await db.collection('exchange_rates').findOne({ _id: new ObjectId(olderInsertedLater.id) });
    assert.equal(preserved.venta.toString(), '3.700');
    const indexes = await db.collection('exchange_rates').listIndexes().toArray();
    assert.deepEqual(indexes.find((index) => index.name === 'latest_rate_capture').key, { fetchedAt: -1, _id: -1 });
  });

  it('keeps a persisted transaction snapshot when a new rate is captured', async () => {
    const initialRate = await capture('2026-10-14T15:00:00.000Z');
    const actor = { id: new ObjectId().toHexString(), rol: 'user' };
    let now = new Date('2026-10-14T15:00:01.000Z');
    const create = new CreateTransaction(transactions, rates, { now: () => now });
    const first = await create.execute(actor, { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
    const nextRate = await capture('2026-10-14T15:00:30.000Z', { compra: '3.990', venta: '4.010' });
    now = new Date('2026-10-14T15:00:31.000Z');
    const second = await create.execute(actor, { monedaOrigen: 'USD', monedaDestino: 'PEN', monto: 100 });
    const history = await transactions.history(
      actor.id,
      new Date('2026-10-14T05:00:00.000Z'),
      new Date('2026-10-15T05:00:00.000Z'),
    );

    assert.deepEqual(history.map((entry) => entry.id), [second.id, first.id]);
    assert.equal(history[1].monto, '100.00');
    assert.equal(history[1].montoCambiado, '373.90');
    assert.equal(history[1].tipoCambio, '3.739');
    assert.equal(history[1].rateId, initialRate.id);
    assert.equal(history[1].rateSide, 'venta');
    assert.equal(history[1].providerDate, '2024-01-18');
    assert.equal(history[0].montoCambiado, '401.00');
    assert.equal(history[0].tipoCambio, '4.010');
    assert.equal(history[0].rateId, nextRate.id);
    const types = await db.collection('transactions').aggregate([
      { $match: { _id: new ObjectId(first.id) } },
      { $project: {
        _id: 0,
        monto: { $type: '$monto' },
        montoCambiado: { $type: '$montoCambiado' },
        tipoCambio: { $type: '$tipoCambio' },
        userId: { $type: '$userId' },
        rateId: { $type: '$rateId' },
        fecha: { $type: '$fecha' },
      } },
    ]).toArray();
    assert.deepEqual(types, [{
      monto: 'decimal',
      montoCambiado: 'decimal',
      tipoCambio: 'decimal',
      userId: 'objectId',
      rateId: 'objectId',
      fecha: 'date',
    }]);
  });

  it('filters ownership and Lima date boundaries before returning ordered history', async () => {
    const rate = await capture('2026-10-14T04:59:00.000Z');
    const actor = { id: new ObjectId().toHexString(), rol: 'user' };
    const other = { id: new ObjectId().toHexString(), rol: 'user' };
    const admin = { id: new ObjectId().toHexString(), rol: 'admin' };
    const save = (userId, fecha) => transactions.save({
      userId,
      monedaOrigen: 'USD',
      monedaDestino: 'PEN',
      monto: '100.00',
      montoCambiado: '373.90',
      tipoCambio: '3.739',
      fecha: new Date(fecha),
      rateId: rate.id,
      providerDate: rate.providerDate,
      rateSide: 'venta',
    });
    const last = await save(actor.id, '2026-10-15T04:59:59.999Z');
    await save(actor.id, '2026-10-15T05:00:00.000Z');
    const first = await save(actor.id, '2026-10-14T05:00:00.000Z');
    await save(actor.id, '2026-10-14T04:59:59.999Z');
    const middle = await save(actor.id, '2026-10-14T15:00:00.000Z');
    const middleTie = await save(actor.id, '2026-10-14T15:00:00.000Z');
    const otherRequest = await save(other.id, '2026-10-14T15:00:00.000Z');
    const query = { startDate: '2026-10-14', endDate: '2026-10-14' };
    const getHistory = new GetTransactionHistory(transactions);
    const own = await getHistory.execute(actor, { ...query, userId: other.id });

    assert.deepEqual(own.map((entry) => entry.id), [last.id, middleTie.id, middle.id, first.id]);
    assert.ok(own.every((entry) => entry.userId === actor.id));
    assert.deepEqual(await getHistory.execute(actor, { ...query, userId: 'ignored-invalid-id' }), own);
    assert.deepEqual(await getHistory.execute(admin, query), []);
    assert.deepEqual((await getHistory.execute(admin, { ...query, userId: other.id })).map((entry) => entry.id), [otherRequest.id]);
    await transactions.ensureIndexes();
    const indexes = await db.collection('transactions').listIndexes().toArray();
    assert.deepEqual(
      indexes.find((index) => index.name === 'transactions_user_date_id').key,
      { userId: 1, fecha: -1, _id: -1 },
    );
  });
});
