const { chromium } = require('playwright');
const fs = require('fs');
const crypto = require('crypto');

const BASE_URL = 'https://www.shisetsu.city.yokohama.lg.jp/user/Home';
const cfg = {
  category: process.env.USAGE_CATEGORY || 'スポーツ',
  purpose: process.env.USAGE_PURPOSE || 'テニス',
  from: process.env.FROM_DATE,
  to: process.env.TO_DATE || process.env.FROM_DATE,
  fromTime: process.env.FROM_TIME || '00:00',
  toTime: process.env.TO_TIME || '24:00',
  weekdays: (process.env.WEEKDAYS || '').split(',').map(s => s.trim()).filter(Boolean),
  searchTarget: process.env.SEARCH_TARGET || '空きコマ',
  areas: (process.env.AREAS || '').split(',').map(s => s.trim()).filter(Boolean),
  roomTypes: (process.env.ROOM_TYPES || '').split(',').map(s => s.trim()).filter(Boolean),
};
const statePath = process.env.STATE_PATH || 'state.json';

function required(name, value) { if (!value) throw new Error(`${name} is required`); }
function normalize(s) { return s.replace(/\s+/g, ' ').trim(); }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
async function clickLabel(page, text) {
  const label = page.locator('label:visible').filter({ hasText: text }).first();
  if (await label.count()) {
    await label.click();
    return true;
  }

  const exact = page.getByText(text, { exact: true }).first();
  if (await exact.count() && await exact.isVisible()) {
    await exact.click();
    return true;
  }

  return false;
}


async function notify(lines) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) { console.warn('NOTIFY_WEBHOOK_URL is not set; notification skipped'); return; }
  const text = `横浜市施設予約の空きが検出されました\n${lines.slice(0, 30).join('\n')}\n確認: ${BASE_URL}`;
  const kind = (process.env.NOTIFY_KIND || 'slack').toLowerCase();
  const payload = kind === 'discord' ? { content: text } : { text };
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`Webhook failed: ${response.status} ${await response.text()}`);
}

async function main() {
  required('FROM_DATE', cfg.from); required('TO_DATE', cfg.to);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'ja-JP' });
  page.setDefaultTimeout(20000);
  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab', { name: /日時から探す/ }).click();
    console.log(JSON.stringify({
  from: cfg.from,
  to: cfg.to,
  category: cfg.category,
  purpose: cfg.purpose,
  weekdays: cfg.weekdays,
  searchTarget: cfg.searchTarget,
  areas: cfg.areas,
  roomTypes: cfg.roomTypes
}, null, 2));
    if (!await clickLabel(page, cfg.category)) throw new Error(`利用目的の分類が見つかりません: ${cfg.category}`);
    if (!await clickLabel(page, cfg.purpose)) throw new Error(`利用目的が見つかりません: ${cfg.purpose}`);
    const dates = page.locator('input[type="date"]');
    if (await dates.count() < 2) throw new Error('利用期間の日付入力欄を特定できません');
    await dates.nth(0).fill(cfg.from); await dates.nth(1).fill(cfg.to);
const timeSelects = page.locator('select');

function siteTimeLabel(value) {
  // サイトは「0:00」「9:00」の形式なので、
  // 「00:00」「09:00」をサイト表示に合わせる
  return value.replace(/^0(?=\d:)/, '');
}

if (await timeSelects.count() >= 2) {
  const fromTimeLabel = siteTimeLabel(cfg.fromTime);
  const toTimeLabel = siteTimeLabel(cfg.toTime);

  await timeSelects.nth(0).selectOption({ label: fromTimeLabel });
  await timeSelects.nth(1).selectOption({ label: toTimeLabel });

  console.log(JSON.stringify({
    selectedFromTime: fromTimeLabel,
    selectedToTime: toTimeLabel
  }));
}

    for (const day of cfg.weekdays) {
  await clickLabel(page, day);
}

await clickLabel(page, cfg.searchTarget);

if (cfg.areas.length > 0) {
  const areaToggle = page.getByRole('button', {
    name: '区名などで絞り込む'
  });

  if (await areaToggle.count() && await areaToggle.isVisible()) {
    await areaToggle.click();
  }

  for (const area of cfg.areas) {
    if (!await clickLabel(page, area)) {
      throw new Error(`地区が見つかりません、または選択できません: ${area}`);
    }
  }
}

    const searchButtons = page.locator('button:visible').filter({ hasText: /^検索$/ });
    if (await searchButtons.count() === 0) throw new Error('表示中の検索ボタンが見つかりません');
    await searchButtons.first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);

    const tables = await page.locator('table').allInnerTexts();
    const body = await page.locator('body').innerText();
    // The home screen itself contains the words 「空きコマ」, so do not treat
    // a validation failure or an unsubmitted form as an available result.
    const resultScreen = new URL(page.url()).pathname !== '/user/Home' || tables.length > 0;
    const rows = resultScreen
      ? (tables.length ? tables.join('\n') : body).split(/\n+/).map(normalize).filter(Boolean)
      : [];
    const availability = rows.filter(x => /空き|予約可|○|〇|利用可/.test(x));
    const result = normalize(availability.join('\n'));
    const current = { checkedAt: new Date().toISOString(), result, hash: sha256(result) };
    const previous = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : null;
    fs.writeFileSync(statePath, JSON.stringify(current, null, 2) + '\n');
    const changedToAvailable = availability.length > 0 && (!previous || previous.hash !== current.hash);
    console.log(JSON.stringify({ changedToAvailable, availabilityCount: availability.length, result: result.slice(0, 4000) }, null, 2));
    if (changedToAvailable) await notify(availability);
  } finally { await browser.close(); }
}

if (require.main === module) main().catch(err => { console.error(err.stack || err); process.exit(1); });
module.exports = { normalize, sha256 };
