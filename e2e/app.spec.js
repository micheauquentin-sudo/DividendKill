import { test, expect } from '@playwright/test';

// Mock all external/backend routes used during app boot
async function mockBase(page, user) {
  await page.route('/auth/me', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user }),
    })
  );
  await page.route('**/api/prices**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ quoteResponse: { result: [], error: null } }),
    })
  );
  await page.route('**/api/funda**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: null, sector: null, beta: null, annual_div: null, pe_cur: null, pay_months: null }),
    })
  );
  await page.route('**/api/nav**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [] }),
    })
  );
  await page.route('**/api/benchmark**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [] }),
    })
  );
}

async function mockAuthSession(page) {
  const user = { name: 'Alice Dupont', email: 'alice@example.com', sub: 'user_test_1' };
  await mockBase(page, user);
  await page.route('**/api/sync**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ transactions: [], settings: {} }),
    })
  );
}

// ── Login screen ─────────────────────────────────────────────

test.describe('Login screen', () => {
  test('shows login overlay when not authenticated', async ({ page }) => {
    await mockBase(page, null);
    await page.goto('/');

    const overlay = page.locator('#loginOverlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Continuer avec Google")')).toBeVisible();
  });

  test('switches to email login panel', async ({ page }) => {
    await mockBase(page, null);
    await page.goto('/');

    await page.locator('#loginOverlay').waitFor({ state: 'visible' });
    await page.locator('#ltab-email').click();

    await expect(page.locator('#login-panel-email')).toBeVisible();
    await expect(page.locator('#loginEmail')).toBeVisible();
    await expect(page.locator('#loginPassword')).toBeVisible();
  });

  test('shows error message on invalid credentials', async ({ page }) => {
    await mockBase(page, null);
    await page.route('/auth/login/email', route =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Email ou mot de passe incorrect' }),
      })
    );

    await page.goto('/');
    await page.locator('#loginOverlay').waitFor({ state: 'visible' });
    await page.locator('#ltab-email').click();
    await page.fill('#loginEmail', 'bad@example.com');
    await page.fill('#loginPassword', 'wrongpass');
    await page.locator('#loginSubmitBtn').click();

    const err = page.locator('#loginError');
    await expect(err).toBeVisible({ timeout: 3000 });
    await expect(err).toContainText('incorrect');
  });

  test('shows rate-limit error after exceeding attempts', async ({ page }) => {
    await mockBase(page, null);

    let attempts = 0;
    await page.route('/auth/login/email', route => {
      attempts++;
      if (attempts > 5) {
        route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Trop de tentatives, réessaie dans 15 min' }),
        });
      } else {
        route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Email ou mot de passe incorrect' }),
        });
      }
    });

    await page.goto('/');
    await page.locator('#loginOverlay').waitFor({ state: 'visible' });
    await page.locator('#ltab-email').click();

    for (let i = 0; i < 6; i++) {
      await page.fill('#loginEmail', 'brute@example.com');
      await page.fill('#loginPassword', `password${i}`);
      await page.locator('#loginSubmitBtn').click();
      await page.waitForTimeout(80);
    }

    await expect(page.locator('#loginError')).toContainText('15 min', { timeout: 3000 });
  });
});

// ── Authenticated app ─────────────────────────────────────────

test.describe('Authenticated app', () => {
  test('hides login overlay and shows user nav button', async ({ page }) => {
    await mockAuthSession(page);
    await page.goto('/');

    await expect(page.locator('#loginOverlay')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('#navUserBtn')).toBeVisible();
  });

  test('displays correct user initial in nav', async ({ page }) => {
    await mockAuthSession(page);
    await page.goto('/');

    await expect(page.locator('#navUserInitial')).toHaveText('A', { timeout: 5000 });
  });

  test('renders accueil panel on load', async ({ page }) => {
    await mockAuthSession(page);
    await page.goto('/');

    await expect(page.locator('#navUserBtn')).toBeVisible({ timeout: 5000 });
    const panel = page.locator('#panel-accueil');
    await expect(panel).toBeAttached();
  });

  test('navigates to rendement panel via tab click', async ({ page }) => {
    await mockAuthSession(page);
    await page.goto('/');

    await expect(page.locator('#navUserBtn')).toBeVisible({ timeout: 5000 });
    await page.locator('.tab').nth(1).click();

    // Panel rendement should now be active (has 'on' class or is visible)
    await expect(page.locator('#panel-rendement')).toBeAttached();
  });

  test('shows import panel when clicking Import tab', async ({ page }) => {
    await mockAuthSession(page);
    await page.goto('/');

    await expect(page.locator('#navUserBtn')).toBeVisible({ timeout: 5000 });
    await page.locator('.tab').last().click();

    await expect(page.locator('#panel-import')).toBeAttached();
  });

  test('renders KPI bar in DOM', async ({ page }) => {
    await mockAuthSession(page);
    await page.goto('/');

    await expect(page.locator('#navUserBtn')).toBeVisible({ timeout: 5000 });
    // KPI bar is present but visually hidden when portfolio is empty
    await expect(page.locator('#kpiBar')).toBeAttached();
    await expect(page.locator('#kv0')).toBeAttached();
  });
});
