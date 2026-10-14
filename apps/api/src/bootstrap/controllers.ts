import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IdentityService } from '../modules/identity/application/identity.service';
import { CreateTransaction } from '../modules/transactions/application/create-transaction';
import { GetTransactionHistory } from '../modules/transactions/application/get-transaction-history';
import type { Transaction } from '../modules/transactions/domain/transaction';
import { DomainError } from '../shared/domain/domain-error';
import { AuthenticationLimitGuard, Public, type ActorRequest } from './http-security';
import type { AppConfig } from './config';

@Public()
@ApiTags('Autenticación')
@UseGuards(AuthenticationLimitGuard)
@Controller('auth')
export class AuthController {
  constructor(@Inject(IdentityService) private readonly identity: IdentityService) {}

  @Post('register')
  @ApiOperation({ summary: 'Registrar usuario con rol user' })
  @ApiBody({ schema: { type: 'object', required: ['nombre', 'email', 'password'], properties: {
    nombre: { type: 'string', minLength: 2, maxLength: 80, example: 'Juan Pérez' },
    email: { type: 'string', format: 'email', maxLength: 254, example: 'juan@example.com' },
    password: { type: 'string', minLength: 8, maxLength: 128, writeOnly: true },
  } } })
  @ApiCreatedResponse({ description: 'Usuario público. El rol siempre es user.' })
  register(@Body() body: unknown) {
    return this.identity.register(body);
  }

  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Iniciar sesión y recibir access_token' })
  @ApiBody({ schema: { type: 'object', required: ['email', 'password'], properties: {
    email: { type: 'string', format: 'email' }, password: { type: 'string', writeOnly: true },
  } } })
  @ApiOkResponse({ description: 'JWT de acceso y usuario con id, nombre, email y rol.' })
  async login(@Body() body: unknown, @Req() request: ActorRequest) {
    const result = await this.identity.login(body);
    request.actor = result.usuario;
    return result;
  }
}

const transactionSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' }, monedaOrigen: { type: 'string', enum: ['USD', 'PEN'] }, monedaDestino: { type: 'string', enum: ['USD', 'PEN'] },
    monto: { type: 'number', example: 100 }, montoCambiado: { type: 'number', example: 373.9 }, tipoCambio: { type: 'number', example: 3.739 },
    fecha: { type: 'string', format: 'date-time' },
  },
};

function transactionResponse(transaction: Transaction) {
  return {
    id: transaction.id,
    monedaOrigen: transaction.monedaOrigen,
    monedaDestino: transaction.monedaDestino,
    monto: Number(transaction.monto),
    montoCambiado: Number(transaction.montoCambiado),
    tipoCambio: Number(transaction.tipoCambio),
    fecha: transaction.fecha.toISOString(),
  };
}

@ApiBearerAuth()
@ApiTags('Solicitudes')
@Controller('transactions')
export class TransactionsController {
  constructor(
    @Inject(CreateTransaction) private readonly create: CreateTransaction,
    @Inject(GetTransactionHistory) private readonly history: GetTransactionHistory,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Registrar cambio usando la última tasa persistida y redondeo HALF_UP a dos decimales' })
  @ApiBody({ schema: { type: 'object', required: ['monedaOrigen', 'monedaDestino', 'monto'], properties: {
    monedaOrigen: { type: 'string', enum: ['USD', 'PEN'] }, monedaDestino: { type: 'string', enum: ['USD', 'PEN'] },
    monto: { type: 'number', minimum: 0.01, maximum: 9999999.99, multipleOf: 0.01 },
  } } })
  @ApiCreatedResponse({ schema: transactionSchema })
  async submit(@Body() body: unknown, @Req() request: ActorRequest) {
    if (!request.actor) throw new DomainError('UNAUTHORIZED', 'Inicia sesión.');
    return transactionResponse(await this.create.execute(request.actor, body));
  }

  @Get('history')
  @ApiOperation({ summary: 'Consultar historial propio o autorizado, fechas inclusivas de America/Lima' })
  @ApiQuery({ name: 'startDate', required: true, type: String, example: '2026-10-01' })
  @ApiQuery({ name: 'endDate', required: true, type: String, example: '2026-10-14' })
  @ApiQuery({ name: 'userId', required: false, type: String, description: 'Solo admin puede seleccionar otro usuario; user ignora este parámetro.' })
  @ApiOkResponse({ schema: { type: 'array', items: transactionSchema } })
  async list(@Query() query: unknown, @Req() request: ActorRequest) {
    if (!request.actor) throw new DomainError('UNAUTHORIZED', 'Inicia sesión.');
    return (await this.history.execute(request.actor, query)).map(transactionResponse);
  }
}

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject('APP_CONFIG') private readonly config: AppConfig) {}

  @Get()
  check() {
    return { status: 'ok', providerMode: this.config.rateProviderMode };
  }
}
