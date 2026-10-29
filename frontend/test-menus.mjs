import puppeteer from 'puppeteer-core';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:5173';

const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc5MzIyMjc0NiwianRpIjoiNWMxZmM2MjEtOTg5Zi00YzJmLTkwNzEtMjIxODc1OTZhM2U3IiwidHlwZSI6ImFjY2VzcyIsInN1YiI6IjEiLCJuYmYiOjE3OTMyMjI3NDYsImNzcmYiOiIzNGUwNDA0Yi02ZDM3LTQ4OWEtOTlkZi1kM2U2NWYxOTdkMDciLCJleHAiOjE3OTM4Mjc1NDYsInJvbGUiOiJhZG1pbiIsInVzZXJuYW1lIjoiYWRtaW4ifQ.6-IWmxL2nvZfMKPFI5wzI90MjxNX-iYXK7MFvrdEBkg';
const ADMIN_USER = { id: 1, role: 'admin', name: 'Admin', username: 'admin' };

async function getRowHeight(page, rowIndex) {
  const rows = await page.$$('.ec-center-row');
  if (rows[rowIndex]) {
    const box = await rows[rowIndex].boundingBox();
    return box ? box.height : null;
  }
  return null;
}

async function getDetailTitleY(page) {
  const title = await page.$('.ec-detail-title');
  if (title) {
    const box = await title.boundingBox();
    return box ? box.y : null;
  }
  return null;
}

async function testMenu(page, viewportName) {
  console.log(`\n========== ${viewportName} ==========`);

  // Go to centers list
  await page.goto(`${BASE}/admin?tab=centers`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  // Test FIRST row menu
  console.log('\n--- FIRST ROW MENU ---');
  const firstRowHeightBefore = await getRowHeight(page, 0);
  console.log(`Row height before: ${firstRowHeightBefore}px`);

  // Click first row's action menu
  const actionCells = await page.$$('.ec-cell-actions');
  if (actionCells.length > 0) {
    const trigger = await actionCells[0].$('.ds-btn--icon.ds-btn--ghost');
    if (trigger) {
      await trigger.click();
      await new Promise(r => setTimeout(r, 300));

      // Check menu
      const openMenus = await page.evaluate(() => {
        const menus = document.querySelectorAll('.ec-floating-menu, .ds-menu[role="menu"]');
        return Array.from(menus).filter(el => getComputedStyle(el).display !== 'none').map(el => {
          const cs = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return {
            className: el.className,
            position: cs.position,
            display: cs.display,
            top: cs.top,
            left: cs.left,
            right: cs.right,
            zIndex: cs.zIndex,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
            viewport: { width: window.innerWidth, height: window.innerHeight },
            fullyVisible: box.x >= 8 && box.x + box.width <= window.innerWidth - 8 && box.y >= 8 && box.y + box.height <= window.innerHeight - 8,
          };
        });
      });
      console.log('Open menus:', JSON.stringify(openMenus, null, 2));

      const firstRowHeightAfter = await getRowHeight(page, 0);
      console.log(`Row height after: ${firstRowHeightAfter}px`);
      console.log(`Row height unchanged: ${firstRowHeightBefore === firstRowHeightAfter ? 'YES' : 'NO'}`);

      // Close with Escape
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Test LAST row menu
  console.log('\n--- LAST ROW MENU ---');
  const lastRowHeightBefore = await getRowHeight(page, actionCells.length - 1);
  console.log(`Row height before: ${lastRowHeightBefore}px`);

  if (actionCells.length > 0) {
    const lastCell = actionCells[actionCells.length - 1];
    const trigger = await lastCell.$('.ds-btn--icon.ds-btn--ghost');
    if (trigger) {
      await trigger.click();
      await new Promise(r => setTimeout(r, 300));

      const openMenus = await page.evaluate(() => {
        const menus = document.querySelectorAll('.ec-floating-menu, .ds-menu[role="menu"]');
        return Array.from(menus).filter(el => getComputedStyle(el).display !== 'none').map(el => {
          const cs = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return {
            className: el.className,
            position: cs.position,
            display: cs.display,
            box: { x: box.x, y: box.y, width: box.width, height: box.height },
            viewport: { width: window.innerWidth, height: window.innerHeight },
            fullyVisible: box.x >= 8 && box.x + box.width <= window.innerWidth - 8 && box.y >= 8 && box.y + box.height <= window.innerHeight - 8,
          };
        });
      });
      console.log('Open menus:', JSON.stringify(openMenus, null, 2));

      const lastRowHeightAfter = await getRowHeight(page, actionCells.length - 1);
      console.log(`Row height after: ${lastRowHeightAfter}px`);
      console.log(`Row height unchanged: ${lastRowHeightBefore === lastRowHeightAfter ? 'YES' : 'NO'}`);

      // Close with outside click
      await page.mouse.click(10, 10);
      await new Promise(r => setTimeout(r, 300));
    }
  }

  // Test DETAIL PAGE MENU
  console.log('\n--- DETAIL PAGE MENU ---');
  await page.goto(`${BASE}/admin?tab=centers`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const firstRow = await page.$('.ec-center-row');
  if (firstRow) { await firstRow.click(); await new Promise(r => setTimeout(r, 2000)); }

  const titleYBefore = await getDetailTitleY(page);
  console.log(`Detail title Y before: ${titleYBefore}px`);

  // Click detail header menu
  const detailTrigger = await page.$('.ec-title-actions .ds-btn--icon.ds-btn--ghost');
  if (detailTrigger) {
    await detailTrigger.click();
    await new Promise(r => setTimeout(r, 300));

    const openMenus = await page.evaluate(() => {
      const menus = document.querySelectorAll('.ec-floating-menu, .ds-menu[role="menu"]');
      return Array.from(menus).filter(el => getComputedStyle(el).display !== 'none').map(el => {
        const cs = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return {
          className: el.className,
          position: cs.position,
          display: cs.display,
          box: { x: box.x, y: box.y, width: box.width, height: box.height },
          viewport: { width: window.innerWidth, height: window.innerHeight },
          fullyVisible: box.x >= 8 && box.x + box.width <= window.innerWidth - 8 && box.y >= 8 && box.y + box.height <= window.innerHeight - 8,
        };
      });
    });
    console.log('Open menus:', JSON.stringify(openMenus, null, 2));

    const titleYAfter = await getDetailTitleY(page);
    console.log(`Detail title Y after: ${titleYAfter}px`);
    console.log(`Title Y unchanged: ${titleYBefore === titleYAfter ? 'YES' : 'NO'}`);

    // Close with Escape
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 300));
  }

  // Check for overflow offenders
  const offenders = await page.evaluate(() => {
    const offenders = [];
    const walk = (el) => {
      if (el === document.documentElement || el === document.body) { return; }
      const sw = el.scrollWidth;
      const cw = el.clientWidth;
      if (sw > cw + 1) {
        offenders.push({
          tag: el.tagName,
          className: el.className || '',
          id: el.id || '',
          scrollWidth: sw,
          clientWidth: cw,
          overflow: Math.round(sw - cw),
        });
      }
      for (const child of el.children) walk(child);
    };
    walk(document.body);
    return offenders;
  });
  console.log(`\nOverflow offenders: ${offenders.length}`);
  for (const o of offenders.slice(0, 10)) {
    console.log(`  - ${o.tag} class="${o.className}" id="${o.id}" scroll=${o.scrollWidth} client=${o.clientWidth} over=${o.overflow}px`);
  }

  // Take screenshot
  const shotPath = `C:/Users/Gesulga/Desktop/evacway-shots/menu-test-${viewportName}.png`;
  await page.screenshot({ path: shotPath, fullPage: true });
  console.log(`Screenshot saved: ${shotPath}`);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('evacway_token', token);
    localStorage.setItem('evacway_user', JSON.stringify(user));
  }, { token: ADMIN_TOKEN, user: ADMIN_USER });

  const viewports = [
    { name: '1366x768', width: 1366, height: 768 },
    { name: '390x844', width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
    await testMenu(page, vp.name);
  }

  await browser.close();
})();