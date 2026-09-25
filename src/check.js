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
};
facilities: (process.env.FACILITIES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean),
const statePath = process.env.STATE_PATH || 'state.json';

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
}
function normalize(s) {
  return s.replace(/\s+/g, ' ').trim();
}
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}
async function clickLabel(page, text) {
  const labels = page.locator('label:visible');
  for (let i = 0; i < await labels.count(); i++) {
    const label = labels.nth(i);
    if (normalize(await label.innerText()) === text) {
      await label.click();
      return true;
    }
  }
  const exact = page.getByText(text, { exact: true }).first();
  if (await exact.count() && await exact.isVisible()) {
    await exact.click();
    return true;
  }
  return false;
}
async function clickNamedLabel(page, inputName, text) {
  const inputs = page.locator(`input[name="${inputName}"]`);
  for (let i = 0; i < await inputs.count(); i++) {
    const id = await inputs.nth(i).getAttribute('id');
    if (!id) continue;
    const label = page.locator(`label[for="${id}"]`);
    if (await label.count() && normalize(await label.innerText()) === text && await label.isVisible()) {
      await label.click();
      return true;
    }
  }
  return false;
}
function siteTimeLabel(value) {
  return value.replace(/^0(?=\d:)/, '');
}
async function notify(lines) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) {
    console.warn('NOTIFY_WEBHOOK_URL is not set; notification skipped');
    return;
  }
  const text = [
    '横浜市施設予約の空きが検出されました',
    '',
    ...lines.slice(0, 30),
    '',
    `確認: ${BASE_URL}`,
    lines.length > 30 ? `（全${lines.length}件中、先頭30件を表示）` : '',
  ].filter(Boolean).join('\n');
  const kind = (process.env.NOTIFY_KIND || 'slack').toLowerCase();
  const payload = kind === 'discord' ? { content: text } : { text };
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status} ${await response.text()}`);
  }
}

async function main() {
  required('FROM_DATE', cfg.from);
  required('TO_DATE', cfg.to);

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
    }, null, 2));

    if (!await clickLabel(page, cfg.category)) {
      throw new Error(`利用目的の分類が見つかりません: ${cfg.category}`);
    }
    if (!await clickLabel(page, cfg.purpose)) {
      throw new Error(`利用目的が見つかりません: ${cfg.purpose}`);
    }

    const dates = page.locator('input[type="date"]');
    if (await dates.count() < 2) {
      throw new Error('利用期間の日付入力欄を特定できません');
    }
    await dates.nth(0).fill(cfg.from);
    await dates.nth(1).fill(cfg.to);

    const timeSelects = page.locator('select');
    if (await timeSelects.count() >= 2) {
      const fromTimeLabel = siteTimeLabel(cfg.fromTime);
      const toTimeLabel = siteTimeLabel(cfg.toTime);
      await timeSelects.nth(0).selectOption({ label: fromTimeLabel });
      await timeSelects.nth(1).selectOption({ label: toTimeLabel });
      console.log(JSON.stringify({
        selectedFromTime: fromTimeLabel,
        selectedToTime: toTimeLabel,
      }));
    }

    for (const day of cfg.weekdays) {
      await clickLabel(page, day);
    }

    if (!await clickLabel(page, cfg.searchTarget)) {
      throw new Error(`検索対象が見つかりません: ${cfg.searchTarget}`);
    }

    if (cfg.areas.length > 0) {
      const areaToggle = page.getByRole('button', {
        name: '区名などで絞り込む',
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

    const searchButtons = page
      .locator('button:visible')
      .filter({ hasText: /^検索$/ });
    if (await searchButtons.count() === 0) {
      throw new Error('表示中の検索ボタンが見つかりません');
    }

    await searchButtons.first().click();
    await page.waitForURL(
      /\/user\/VacantFrameFacilityStatus/,
      { timeout: 30000, waitUntil: 'commit' },
    );
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.locator('table.facilities').waitFor({
      state: 'visible',
      timeout: 30000,
    }).catch(() => {});
    await page.waitForTimeout(1000);

    const more = page.getByRole('button', { name: 'さらに読み込む' });
    const dialogs = page.locator('[role="dialog"]:visible');
    if (await dialogs.count()) {
      console.log(`result dialog: ${normalize(await dialogs.first().innerText())}`);
      const close = dialogs.first().getByRole('button', { name: '閉じる' });
      if (await close.count()) await close.click();
      await dialogs.first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    }
    for (let i = 0; i < 100; i++) {
      if (await more.count() === 0 || !await more.isVisible()) break;
      await more.click();
      await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(150);
    }

    const resultRows = page.locator('table.facilities tbody tr:visible');
    const availability = [];
    for (let i = 0; i < await resultRows.count(); i++) {
      const cells = await resultRows.nth(i).locator('td.detail').allInnerTexts();
      const values = cells.map(normalize).filter(Boolean);
      if (values.length >= 4) {
        availability.push(values.slice(0, 4).join(' | '));
      }
    }

    const previous = fs.existsSync(statePath)
      ? JSON.parse(fs.readFileSync(statePath, 'utf8'))
      : null;

    const previousLines = previous?.result
      ? previous.result.split('\n').map(normalize).filter(Boolean)
      : [];
    const previousSet = new Set(previousLines);
    const newAvailability = availability.filter(line => !previousSet.has(line));

    const result = availability.join('\n');
    const current = {
      checkedAt: new Date().toISOString(),
      result,
      hash: sha256(result),
    };
    fs.writeFileSync(statePath, JSON.stringify(current, null, 2) + '\n');

    const changedToAvailable = newAvailability.length > 0;

    console.log(JSON.stringify({
      changedToAvailable,
      availabilityCount: availability.length,
      newAvailabilityCount: newAvailability.length,
      result: result.slice(0, 4000),
    }, null, 2));

    if (changedToAvailable) {
      await notify(newAvailability);
    }
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.stack || err);
    process.exit(1);
  });
}

module.exports = { normalize, sha256 };


