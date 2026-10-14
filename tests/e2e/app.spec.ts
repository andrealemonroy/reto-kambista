import { randomUUID } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const apiUrl = 'http://127.0.0.1:4000';
const appUrl = 'http://127.0.0.1:5173';
const password = 'E2E-password-2026';

interface Account {
  nombre: string;
  email: string;
  password: string;
}

let account: Account;

function newAccount(): Account {
  return { nombre: 'Persona de prueba', email: `e2e-${randomUUID()}@example.com`, password };
}

async function waitForApi(request: APIRequestContext) {
  await expect.poll(async () => {
    try {
      const response = await request.get(`${apiUrl}/health`, { timeout: 1500 });
      if (!response.ok()) return false;
      const result: unknown = await response.json();
      return Boolean(result && typeof result === 'object' && 'status' in result && result.status === 'ok' && 'providerMode' in result && result.providerMode === 'fixture');
    } catch {
      return false;
    }
  }, { timeout: 60_000, intervals: [250, 500, 1000, 2000], message: 'La API de demostración debe estar disponible con el proveedor fixture.' }).toBe(true);
}

async function registerAccount(request: APIRequestContext): Promise<Account> {
  const identity = newAccount();
  const response = await request.post(`${apiUrl}/v1/auth/register`, { data: identity });
  expect(response.status()).toBe(201);
  return identity;
}

async function fillLogin(page: Page, identity: Account) {
  await page.getByLabel('Correo electrónico', { exact: true }).fill(identity.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
}

async function login(page: Page, identity = account) {
  await page.goto('/login');
  await fillLogin(page, identity);
  await expect(page).toHaveURL(`${appUrl}/exchange`);
}

async function createTransaction(page: Page, amount = '100'): Promise<string> {
  await page.getByLabel('Monto a cambiar', { exact: true }).fill(amount);
  const response = page.waitForResponse((candidate) => candidate.url() === `${apiUrl}/v1/transactions` && candidate.request().method() === 'POST');
  await page.getByRole('button', { name: 'Registrar solicitud', exact: true }).click();
  expect((await response).status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Solicitud registrada', exact: true })).toBeVisible();
  const id = await page.getByTestId('transaction-id').textContent();
  expect(id).toBeTruthy();
  return id!.trim();
}

function historyRequest(url: URL): boolean {
  return url.origin === apiUrl && url.pathname === '/v1/transactions/history';
}

test.beforeAll(async ({ request }) => {
  test.setTimeout(75_000);
  await waitForApi(request);
  account = await registerAccount(request);
});

test('registro, login, ambas conversiones, historial y cierre de sesión', async ({ page }) => {
  const identity = newAccount();
  await page.goto('/register');
  await expect(page.getByText('Modo demostración.', { exact: true })).toBeVisible();
  await page.getByLabel('Nombre completo', { exact: true }).fill(identity.nombre);
  await page.getByLabel('Correo electrónico', { exact: true }).fill(identity.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Crear mi cuenta', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?registered=true$/);
  await expect(page.getByText('Cuenta creada. Inicia sesión para continuar.', { exact: true })).toBeVisible();
  await fillLogin(page, identity);
  await expect(page).toHaveURL(`${appUrl}/exchange`);
  await expect(page.getByTestId('transaction-result')).toHaveCount(0);
  const firstId = await createTransaction(page);
  await expect(page.getByTestId('transaction-result')).toContainText('373.90');
  await expect(page.getByTestId('transaction-result')).toContainText('3.739');
  await page.getByRole('button', { name: 'Intercambiar monedas', exact: true }).click();
  const secondId = await createTransaction(page, '373.30');
  expect(secondId).not.toBe(firstId);
  await expect(page.getByTestId('transaction-result')).toContainText('100.00');
  await expect(page.getByTestId('transaction-result')).toContainText('3.733');
  await page.getByRole('link', { name: 'Historial', exact: true }).click();
  await expect(page.getByTestId('transaction-row')).toHaveCount(2);
  await expect(page.getByTestId('history-results')).toContainText(firstId);
  await expect(page.getByTestId('history-results')).toContainText(secondId);
  await expect(page.getByLabel('ID de usuario (opcional)', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  await page.getByRole('button', { name: 'Cerrar sesión', exact: false }).click();
  await expect(page).toHaveURL(`${appUrl}/login`);
  await expect(page.getByTestId('transaction-row')).toHaveCount(0);
});

test('protege rutas, conserva el destino seguro y pierde la sesión al recargar', async ({ page }) => {
  await page.goto('/history');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  expect(new URL(page.url()).searchParams.get('redirect')).toBe('/history');
  await fillLogin(page, account);
  await expect(page).toHaveURL(`${appUrl}/history`);
  await page.reload();
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.getByRole('button', { name: 'Cerrar sesión', exact: false })).toHaveCount(0);
});

test('rechaza montos inválidos y monedas iguales antes de llamar a la API', async ({ page }) => {
  await login(page);
  let submissions = 0;
  page.on('request', (request) => {
    if (request.url() === `${apiUrl}/v1/transactions` && request.method() === 'POST') submissions += 1;
  });
  for (const amount of ['0', '10000000', '12.345', '1e3']) {
    await page.getByLabel('Monto a cambiar', { exact: true }).fill(amount);
    await page.getByRole('button', { name: 'Registrar solicitud', exact: true }).click();
    await expect(page.getByLabel('Monto a cambiar', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByLabel('Monto a cambiar', { exact: true })).toBeFocused();
  }
  await page.getByLabel('Monto a cambiar', { exact: true }).fill('100');
  await expect(page.getByLabel('Monto a cambiar', { exact: true })).toHaveAttribute('aria-invalid', 'false');
  await page.getByLabel('Moneda que recibes', { exact: true }).selectOption('USD');
  await page.getByRole('button', { name: 'Registrar solicitud', exact: true }).click();
  await expect(page.getByText('Selecciona una moneda distinta de la que envías.', { exact: true })).toBeVisible();
  expect(submissions).toBe(0);
});

test('presenta un historial vacío y valida el orden del rango', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Historial', exact: true }).click();
  await page.getByLabel('Desde', { exact: true }).fill('2000-01-01');
  await page.getByLabel('Hasta', { exact: true }).fill('2000-01-01');
  await page.getByRole('button', { name: 'Consultar historial', exact: true }).click();
  await expect(page.getByTestId('history-empty')).toBeVisible();
  await expect(page.getByTestId('transaction-row')).toHaveCount(0);
  await page.getByLabel('Desde', { exact: true }).fill('2000-01-02');
  await page.getByRole('button', { name: 'Consultar historial', exact: true }).click();
  await expect(page.getByLabel('Hasta', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('La fecha de fin debe ser igual o posterior a la de inicio.', { exact: true })).toBeVisible();
});

test('una respuesta POST perdida registra una vez y permite comprobar el historial', async ({ page }) => {
  await login(page);
  let submissions = 0;
  let recordedId = '';
  await page.route(`${apiUrl}/v1/transactions`, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    submissions += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    const body = await response.json() as { id: string };
    recordedId = body.id;
    await route.abort('failed');
  });
  await page.getByLabel('Monto a cambiar', { exact: true }).fill('25.50');
  await page.getByRole('button', { name: 'Registrar solicitud', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('La solicitud podría haberse registrado');
  await expect(page.getByTestId('transaction-result')).toHaveCount(0);
  await page.getByRole('link', { name: 'Ver mi historial', exact: false }).click();
  await expect(page.getByTestId('history-results')).toContainText(recordedId);
  expect(recordedId).not.toBe('');
  expect(submissions).toBe(1);
});

test('un 401 elimina la sesión y una cuenta diferente ve solo su historial', async ({ page, request }) => {
  const otherAccount = await registerAccount(request);
  await login(page);
  const privateId = await createTransaction(page, '50');
  let injected = false;
  await page.route(historyRequest, async (route) => {
    if (injected || route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    injected = true;
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': appUrl },
      body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'Tu sesión expiró.', requestId: 'e2e-expired-session' }),
    });
  });
  await page.getByRole('link', { name: 'Historial', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.getByText('Tu sesión terminó. Inicia sesión nuevamente para continuar.', { exact: true })).toBeVisible();
  await expect(page.getByTestId('transaction-row')).toHaveCount(0);
  await page.unroute(historyRequest);
  await fillLogin(page, otherAccount);
  await expect(page).toHaveURL(`${appUrl}/history`);
  await expect(page.getByTestId('history-empty')).toBeVisible();
  await expect(page.getByText(privateId, { exact: true })).toHaveCount(0);
});

test('descarta una respuesta tardía del usuario anterior después de cambiar de sesión', async ({ page, request }) => {
  const otherAccount = await registerAccount(request);
  await login(page);
  const privateId = await createTransaction(page, '75');
  let release!: () => void;
  let captured!: () => void;
  let settled!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const responseCaptured = new Promise<void>((resolve) => { captured = resolve; });
  const responseSettled = new Promise<void>((resolve) => { settled = resolve; });
  await page.route(historyRequest, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.continue();
      return;
    }
    try {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = await response.body();
      captured();
      await released;
      await route.fulfill({ response, body }).catch(() => undefined);
    } finally {
      settled();
    }
  });
  await page.getByRole('link', { name: 'Historial', exact: true }).click();
  await responseCaptured;
  await page.getByRole('button', { name: 'Cerrar sesión', exact: false }).click();
  await expect(page).toHaveURL(`${appUrl}/login`);
  await fillLogin(page, otherAccount);
  await expect(page).toHaveURL(`${appUrl}/exchange`);
  release();
  await responseSettled;
  await page.unroute(historyRequest);
  await expect(page.getByText(privateId, { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Historial', exact: true }).click();
  await expect(page.getByTestId('history-empty')).toBeVisible();
  await expect(page.getByTestId('transaction-row')).toHaveCount(0);
});
