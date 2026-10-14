import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { DynamicModule, Module, RequestMethod, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import helmet from 'helmet';
import { MongoClient } from 'mongodb';
import { SystemClock, type Clock } from '../shared/domain/clock';
import { IdentityService } from '../modules/identity/application/identity.service';
import { MongoUserRepository } from '../modules/identity/infrastructure/mongo-user.repository';
import { ArgonPasswordHasher } from '../modules/identity/infrastructure/argon-password.hasher';
import { JwtTokens } from '../modules/identity/infrastructure/jwt-tokens';
import { SyncExchangeRate } from '../modules/rates/application/sync-exchange-rate';
import { MongoExchangeRateRepository } from '../modules/rates/infrastructure/mongo-exchange-rate.repository';
import { SunatRateProvider } from '../modules/rates/infrastructure/sunat-rate.provider';
import { FixtureRateProvider } from '../modules/rates/infrastructure/fixture-rate.provider';
import type { RateProvider } from '../modules/rates/application/ports';
import { MongoTransactionRepository } from '../modules/transactions/infrastructure/mongo-transaction-repository';
import { CreateTransaction } from '../modules/transactions/application/create-transaction';
import { GetTransactionHistory } from '../modules/transactions/application/get-transaction-history';
import type { AppConfig } from './config';
import { JsonLogger } from './json-logger';
import { AuthLimiter } from './auth-limiter';
import { AccessGuard, ApiErrorFilter, AuthenticationLimitGuard, type ActorRequest } from './http-security';
import { AuthController, HealthController, TransactionsController } from './controllers';
import { RatesLifecycle } from './rates-lifecycle';

@Module({})
class RuntimeModule {}

export interface ApplicationOptions {
  clock?: Clock;
  logger?: JsonLogger;
  rateProvider?: RateProvider;
  startScheduler?: boolean;
}

export async function createApplication(config: AppConfig, options: ApplicationOptions = {}) {
  const clock = options.clock ?? new SystemClock();
  const logger = options.logger ?? new JsonLogger();
  const mongo = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 5000 });
  await mongo.connect();
  const db = mongo.db(config.database);
  let app: INestApplication | undefined;
  try {
    const users = new MongoUserRepository(db);
    const rates = new MongoExchangeRateRepository(db);
    const transactions = new MongoTransactionRepository(db);
    await Promise.all([users.ensureIndexes(), rates.ensureIndexes(), transactions.ensureIndexes()]);
    const passwords = new ArgonPasswordHasher();
    const tokens = new JwtTokens(config.jwtSecret, config.jwtIssuer, config.jwtAudience, config.accessTokenSeconds, clock);
    const identity = new IdentityService(users, passwords, tokens, clock, await passwords.hash(randomUUID()));
    const rateProvider = options.rateProvider ?? (config.rateProviderMode === 'fixture'
      ? new FixtureRateProvider()
      : new SunatRateProvider(config.rateProviderUrl, config.rateProviderToken, config.rateTimeoutMs));
    const syncRates = new SyncExchangeRate(rates, rateProvider, clock);
    const createTransaction = new CreateTransaction(transactions, rates, clock);
    const history = new GetTransactionHistory(transactions);
    const module: DynamicModule = {
      module: RuntimeModule,
      controllers: [AuthController, TransactionsController, HealthController],
      providers: [
        { provide: 'APP_CONFIG', useValue: config },
        { provide: IdentityService, useValue: identity },
        { provide: CreateTransaction, useValue: createTransaction },
        { provide: GetTransactionHistory, useValue: history },
        { provide: AuthLimiter, useValue: new AuthLimiter(clock, config.authRateWindowMs, config.authRateIpLimit, config.authRateAccountLimit) },
        { provide: APP_GUARD, useClass: AccessGuard },
        AuthenticationLimitGuard,
        { provide: 'DATABASE_LIFECYCLE', useValue: { onApplicationShutdown: () => mongo.close() } },
        ...(options.startScheduler === false ? [] : [{ provide: RatesLifecycle, useValue: new RatesLifecycle(syncRates, config.rateIntervalMs, logger) }]),
      ],
    };
    app = await NestFactory.create(module, { logger, bodyParser: false, abortOnError: false });
    app.use((request: ActorRequest, response: express.Response, next: express.NextFunction) => {
      const incoming = request.headers['x-request-id'];
      request.requestId = typeof incoming === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(incoming) ? incoming : randomUUID();
      response.setHeader('X-Request-Id', request.requestId);
      response.setHeader('Cache-Control', 'no-store');
      const started = performance.now();
      response.once('finish', () => logger.event('info', 'http_request', {
        requestId: request.requestId, method: request.method, endpoint: request.path, status: response.statusCode,
        durationMs: Math.round((performance.now() - started) * 100) / 100, userId: request.actor?.id,
      }));
      next();
    });
    app.use(helmet({ contentSecurityPolicy: false }));
    app.use(express.json({ limit: '16kb' }));
    app.enableCors({ origin: config.webOrigin, credentials: false, exposedHeaders: ['X-Request-Id', 'Retry-After'] });
    app.setGlobalPrefix('v1', { exclude: [{ path: 'health', method: RequestMethod.GET }] });
    app.useGlobalFilters(new ApiErrorFilter(logger));
    const api = new DocumentBuilder().setTitle('API de cambio de divisas').setVersion('1.0.0').addBearerAuth().build();
    SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, api), { swaggerOptions: { persistAuthorization: false } });
    app.enableShutdownHooks();
    return { app, db, services: { identity, rates, transactions, users, syncRates, tokens } };
  } catch (error) {
    if (app) await app.close();
    await mongo.close();
    throw error;
  }
}
