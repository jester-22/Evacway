import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:5173';

const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc5MzIyMjc0NiwianRpIjoiNWMxZmM2MjEtOTg5Zi00YzJmLTkwNzEtMjIxODc1OTZhM2U3IiwidHlwZSI6ImFjY2VzcyIsInN1YiI6IjEiLCJuYmYiOjE3OTMyMjI3NDYsImNzcmYiOiIzNGUwNDA0Yi02ZDM3LTQ4OWEtOTlkZi1kM2U2NWYxOTdkMDciLCJleHAiOjE3OTM4Mjc1NDYsInJvbGUiOiJhZG1pbiIsInVzZXJuYW1lIjoiYWRtaW4ifQ.6-IWmxL2nvZfMKPFI5wzI90MjxNX-iYXK7MFvrdEBkg';
const ADMIN_USER = { id: 1, role: 'admin', name: 'Admin', username: 'admin' };

async function getPaddingInfo(page, selector) {
  const el = await page.$(selector);
  if (!el) return { selector, found: false };
  const styles = await page.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      padding: cs.padding,
      paddingTop: cs.paddingTop,
      paddingRight: cs.paddingRight,
      paddingBottom: cs.paddingBottom,
      paddingLeft: cs.paddingLeft,
      margin: cs.margin,
      marginTop: cs.marginTop,
      marginRight: cs.marginRight,
      marginBottom: cs.marginBottom,
      marginLeft: cs.marginLeft,
      maxWidth: cs.maxWidth,
      width: cs.width,
      boxSizing: cs.boxSizing,
      display: cs.display,
      flexDirection: cs.flexDirection,
      gap: cs.gap,
    };
  }, el);
  const box = await el.boundingBox();
  return { selector, found: true, ...styles, box };
}

async function getComputedRules(page, selector) {
  const el = await page.$(selector);
  if (!el) return null;
  return await page.evaluate(el => {
    const cs = getComputedStyle(el);
    const rules = {};
    for (let i = 0; i < cs.length; i++) {
      const prop = cs[i];
      const val = cs.getPropertyValue(prop);
      if (val && val !== 'initial' && val !== 'auto' && val !== 'none' && val !== '0px' && val !== 'normal' && val !== 'transparent' && val !== 'rgba(0, 0, 0, 0)') {
        rules[prop] = val.trim();
      }
    }
    return rules;
  }, el);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // Login
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('evacway_token', token);
    localStorage.setItem('evacway_user', JSON.stringify(user));
  }, { token: ADMIN_TOKEN, user: ADMIN_USER });

  const viewports = [
    { name: '1366x768', width: 1366, height: 768 },
    { name: '390x844', width: 390, height: 844 },
  ];

  const selectors = [
    '.ec-detail',
    '.ec-detail-header',
    '.ec-breadcrumb',
    '.ec-kpi-strip',
    '.ec-tab-panel.is-active',
    '.ec-tab-panel[aria-hidden="false"]',
  ];

  for (const vp of viewports) {
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/admin?tab=centers`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));

    const firstRow = await page.$('.ec-center-row');
    if (firstRow) { await firstRow.click(); await new Promise(r => setTimeout(r, 2000)); }

    console.log(`\n========== ${vp.name} ==========`);

    for (const sel of selectors) {
      const info = await getPaddingInfo(page, sel);
      if (info.found) {
        console.log(`\n${sel}:`);
        console.log(`  box: x=${info.box?.x.toFixed(1)}, y=${info.box?.y.toFixed(1)}, w=${info.box?.width.toFixed(1)}, h=${info.box?.height.toFixed(1)}`);
        console.log(`  padding: ${info.padding}`);
        console.log(`  margin: ${info.margin}`);
        console.log(`  maxWidth: ${info.maxWidth}`);
        console.log(`  width: ${info.width}`);
        console.log(`  boxSizing: ${info.boxSizing}`);
        console.log(`  display: ${info.display}`);
        console.log(`  flexDirection: ${info.flexDirection}`);
        console.log(`  gap: ${info.gap}`);

        // Get key CSS rules
        const rules = await getComputedRules(page, sel);
        if (rules) {
          console.log(`  Key computed rules:`);
          for (const [prop, val] of Object.entries(rules)) {
            if (['padding', 'margin', 'max-width', 'width', 'box-sizing', 'display', 'flex-direction', 'gap', 'border', 'background', 'border-radius', 'box-shadow'].includes(prop)) {
              console.log(`    ${prop}: ${val}`);
            }
          }
        }
      } else {
        console.log(`\n${sel}: NOT FOUND`);
      }
    }

    // Check KPI card padding
    const kpiCard = await page.$('.ds-card');
    if (kpiCard) {
      const info = await getPaddingInfo(page, '.ds-card');
      if (info.found) {
        console.log(`\n.ds-card (KPI):`);
        console.log(`  padding: ${info.padding}`);
      }
    }
  }

  await browser.close();
})();