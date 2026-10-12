import { expect, test, type Page } from '@playwright/test';

/** Keeps the tests on this machine: everything outside the local server is refused (Lichess, GitHub, fonts…). */
export async function offline(page: Page) {
  await page.context().route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
}

/** A fresh start: the first screen, a player, and optionally a first repertoire from a PGN. */
export async function start(page: Page, rep?: { name: string; side?: 'white' | 'black'; pgn: string }) {
  await offline(page);
  await page.goto('/');
  await page.getByPlaceholder('Name').fill('Tester');
  await page.getByRole('button', { name: 'Get started' }).click();
  if (!rep) return;
  await page.locator('main').getByRole('button', { name: 'New repertoire' }).click();
  const dialog = page.locator('.dialog');
  await dialog.getByPlaceholder(/^e\.g\./).fill(rep.name);
  if (rep.side === 'black') await dialog.getByRole('button', { name: /Black/ }).click();
  await dialog.locator('textarea').fill(rep.pgn);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toHaveCount(0);
}

export const go = (page: Page, view: 'Overview' | 'Build' | 'Tree' | 'Train' | 'Play' | 'Check' | 'Games') =>
  page.locator(`nav.nav button[title="${view}"]`).click();

/** Plays a move on the board by tapping (or clicking) its two squares. */
export async function move(page: Page, from: string, to: string, board = page.locator('cg-board').first()) {
  const box = (await board.boundingBox())!;
  const black = await board.evaluate((el) => !!el.closest('.orientation-black'));
  const size = box.width / 8;
  const at = (sq: string) => {
    const f = sq.charCodeAt(0) - 97;
    const r = Number(sq[1]) - 1;
    return { x: box.x + ((black ? 7 - f : f) + 0.5) * size, y: box.y + ((black ? r : 7 - r) + 0.5) * size };
  };
  const touch = !!test.info().project.use.hasTouch;
  for (const sq of [from, to]) {
    const { x, y } = at(sq);
    if (touch) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
  }
}
