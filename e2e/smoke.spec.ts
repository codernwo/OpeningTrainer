// The main routes through the app, on desktop and phone width: a repertoire from a PGN, training it, a game with its
// analysis, and a move against Maia. Slow parts (Stockfish, Maia) run for real, in the browser.
import { expect, test } from '@playwright/test';
import { go, move, start } from './helpers';

const REP = '1. e4 {The main move} e5 2. Nf3 {Develops with tempo} (2. Bc4) Nc6 *';

test('a repertoire from a PGN: overview, build and tree', async ({ page }) => {
  await start(page, { name: 'Open games', pgn: REP });
  await go(page, 'Overview');
  const card = page.locator('.rep-card');
  await expect(card).toContainText('Open games');
  await expect(card.locator('.stat', { hasText: 'lines' })).toContainText('2');
  // Actions sit in the ⋯ menu.
  await card.getByRole('button', { name: /More for/ }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Pause training', 'Download as PGN', 'Import a PGN (add or replace)…', 'Delete…']);
  await page.keyboard.press('Escape');
  await go(page, 'Tree');
  await expect(page.locator('.tree-svg text', { hasText: /^Start$/ })).toBeVisible();
  await expect(page.locator('.tree-svg')).toContainText('2.Bc4');
  await go(page, 'Build');
  await expect(page.locator('cg-board')).toBeVisible();
});

test("train: today's session learns the new moves, then recalls them", async ({ page }) => {
  await start(page, { name: 'Open games', pgn: REP });
  await go(page, 'Overview');
  // The same number on the Overview, the Train tab and its badge.
  await expect(page.locator('main')).toContainText('Today: 3 new moves.');
  await expect(page.locator('nav.nav button[title="Train"] .badge')).toHaveText('3');
  await page.getByRole('button', { name: 'Train (3)' }).click();
  await expect(page.locator('.today-bar')).toContainText('part 1 of 1 · Open games: new moves (3)');
  const feedback = page.locator('.feedback');
  const squares: Record<string, [string, string]> = { e4: ['e2', 'e4'], Nf3: ['g1', 'f3'], Bc4: ['f1', 'c4'] };
  const done = page.getByText('Today done');
  const ready = async () =>
    (await done.count()) > 0 || /New move: play|What do you play here|repertoire too/.test((await feedback.textContent().catch(() => '')) ?? '');
  for (let step = 0; step < 20; step++) {
    await expect.poll(ready).toBe(true);
    if (await done.count()) break;
    await page.waitForTimeout(600); // the card's position is set up in two steps
    const text = await feedback.innerText();
    const line = await page.locator('.train .card .small.muted').first().innerText();
    const learn = /New move: play (\S+)/.exec(text)?.[1];
    let san = learn ?? (line === 'Starting position' ? 'e4' : 'Nf3');
    await move(page, ...squares[san]);
    if (!learn && san === 'Nf3') {
      // Two moves of yours here: a card asks for its own one.
      await page.waitForTimeout(300);
      if (/repertoire too/.test(await feedback.innerText())) {
        san = 'Bc4';
        await page.waitForTimeout(1300);
        await move(page, ...squares.Bc4);
      }
    }
    const next = page.getByRole('button', { name: 'Continue' });
    await page.waitForTimeout(400);
    if (await next.count()) await next.click();
  }
  await expect(page.getByText('Today done')).toBeVisible();
  await expect(page.locator('.stat', { hasText: 'right first time' })).toContainText('3');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.today-card')).toContainText('Nothing to train right now');
});

test('a game: import, analysis without spoilers, find a better move', async ({ page }) => {
  await start(page);
  await go(page, 'Games');
  await page.getByRole('button', { name: 'Add your first games' }).click();
  const dialog = page.locator('.dialog');
  await dialog.locator('.chip', { hasText: 'PGN file' }).click();
  await dialog.locator('textarea').fill('[White "Opponent"]\n[Black "Me"]\n[Result "1-0"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0\n');
  await dialog.locator('select').selectOption('Me');
  await dialog.locator('button.primary').click();
  await expect(page.locator('.game-row')).toHaveCount(1);
  await expect(page.locator('.game-row .game-stats')).toContainText('%', { timeout: 90_000 });
  await page.locator('.game-row').click();

  const momentCard = page.locator('.moment-card');
  await expect(momentCard).toContainText('3…Nf6');
  await expect(momentCard).toContainText('can you find it');
  const closed = await momentCard.innerText();
  await expect(momentCard.locator('.theme-chip')).toHaveCount(0);

  // Hints in steps, then the answer.
  await momentCard.getByRole('button', { name: 'Find a better move' }).click();
  await page.getByRole('button', { name: 'Hint', exact: true }).click();
  await expect(page.getByText('the piece to move is circled')).toBeVisible();
  await page.getByRole('button', { name: 'Another hint' }).click();
  await expect(page.getByRole('button', { name: 'Another hint' })).toBeDisabled();
  await page.getByRole('button', { name: 'Show the move' }).click();
  await expect(page.locator('.feedback')).toContainText('The move was 3…');
  await page.getByRole('button', { name: 'Done' }).click();
  const play = momentCard.getByRole('button', { name: /^Play \S+ vs Maia$/ });
  await expect(play).toBeVisible();
  const best = /^Play (\S+) vs Maia$/.exec((await play.innerText()).trim())![1];
  expect(closed).not.toContain(best);
});

test('play: a move against Maia', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'Maia is loaded once; the desktop run covers it.');
  await start(page);
  await go(page, 'Play');
  await page.getByRole('button', { name: /White$/ }).click();
  await page.getByRole('button', { name: /Start game|and start/ }).click();
  await expect(page.locator('cg-board')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  await move(page, 'e2', 'e4');
  // Maia answers: the move list has a reply for Black.
  await expect(page.locator('div[style*="max-height: 220px"] b')).toHaveCount(2, { timeout: 60_000 });
});

test('no screen is wider than the window', async ({ page }) => {
  await start(page, { name: 'Open games', pgn: REP });
  for (const view of ['Overview', 'Build', 'Tree', 'Train', 'Play', 'Check', 'Games'] as const) {
    await go(page, view);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, view).toBeLessThanOrEqual(0);
  }
});
