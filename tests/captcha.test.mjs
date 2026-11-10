import test from 'node:test';
import assert from 'node:assert/strict';

// A tiny fake page: just enough of the DOM and of Cloudflare's script for captcha.js.
function fakePage({ renderThrows = false } = {}) {
  const el = () => ({ style: {}, hidden: false, textContent: '', removed: false, children: [], append(...c) { this.children.push(...c); }, remove() { this.removed = true; } });
  const made = [];
  const opts = {};
  const removedWidgets = [];
  globalThis.document = { createElement: () => { const e = el(); made.push(e); return e; }, body: { appendChild() {} }, head: { appendChild() {} } };
  globalThis.window = { turnstile: {
    render(_box, o) { if (renderThrows) throw new Error('render failed'); Object.assign(opts, o); return 'w1'; },
    remove(id) { removedWidgets.push(id); },
  } };
  return { opts, made, removedWidgets, box: () => made[0], note: () => made[1] };
}
const load = async (key) => {
  if (key) process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = key; else delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return import(`../lib/captcha.js?${key ?? 'off'}-${Math.random()}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('with no site key the check is off and returns nothing', async () => {
  const { getCaptchaToken, captchaEnabled } = await load(null);
  assert.equal(captchaEnabled, false);
  assert.equal(await getCaptchaToken(), undefined);
});

test('a passed check returns its token and tidies up', async () => {
  const page = fakePage();
  const { getCaptchaToken, captchaEnabled } = await load('site-key');
  assert.equal(captchaEnabled, true);
  const pending = getCaptchaToken();
  await wait(5);
  assert.equal(page.opts.sitekey, 'site-key');
  assert.equal(page.opts.appearance, 'interaction-only');
  page.opts.callback('tok123');
  assert.equal(await pending, 'tok123');
  assert.ok(page.box().removed);
  assert.deepEqual(page.removedWidgets, ['w1']);
});

test('the explanation appears only when a tap is needed, and the wait becomes longer', async () => {
  const page = fakePage();
  const { getCaptchaToken } = await load('site-key');
  let settled = false;
  const pending = getCaptchaToken({ timeoutMs: 40, interactiveTimeoutMs: 400 }).finally(() => { settled = true; });
  await wait(5);
  assert.equal(page.note().hidden, true, 'hidden while the check is silent');
  page.opts['before-interactive-callback']();
  assert.equal(page.note().hidden, false, 'shown when Cloudflare asks for a tap');
  assert.ok(page.note().textContent.length > 10);
  await wait(120); // well past the short timeout
  assert.equal(settled, false, 'still waiting for the person to tap');
  page.opts['after-interactive-callback']();
  assert.equal(page.note().hidden, true);
  page.opts.callback('tok-after-tap');
  assert.equal(await pending, 'tok-after-tap');
});

test('a silent check that never finishes times out and cleans up', async () => {
  const page = fakePage();
  const { getCaptchaToken } = await load('site-key');
  await assert.rejects(getCaptchaToken({ timeoutMs: 20 }), /captcha_timeout/);
  assert.ok(page.box().removed);
  assert.deepEqual(page.removedWidgets, ['w1']);
});

test('a check that errors, or cannot even start, is reported as failed and cleans up', async () => {
  let page = fakePage();
  let { getCaptchaToken } = await load('site-key');
  const pending = getCaptchaToken();
  await wait(5);
  page.opts['error-callback']();
  await assert.rejects(pending, /captcha_failed/);
  assert.ok(page.box().removed);

  page = fakePage({ renderThrows: true });
  ({ getCaptchaToken } = await load('site-key'));
  await assert.rejects(getCaptchaToken(), /captcha_failed/);
  assert.ok(page.box().removed);
});
