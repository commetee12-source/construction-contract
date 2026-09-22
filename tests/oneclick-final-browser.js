async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  await page.reload();
  await page.getByRole('button', {name: '원클릭 서류 작성', exact: true}).click();
  const pane = page.getByRole('region', {name: '원클릭 서류 작성', exact: true});
  let previews = 0;
  for (const book of ['construction-seoul', 'construction-other', 'design-seoul', 'design-other']) {
    await pane.getByRole('combobox', {name: '원클릭 프로그램 선택'}).selectOption(book);
    const select = pane.getByRole('combobox', {name: '미리보기 서식'});
    const names = await select.locator('option').evaluateAll(options => options.map(option => option.value));
    for (const name of names) {
      await select.selectOption(name);
      assert(await pane.locator('.oc-preview-frame .oc-error').count() === 0, book + ' preview failed: ' + name);
      previews++;
    }
  }
  await pane.getByRole('combobox', {name: '원클릭 프로그램 선택'}).selectOption('construction-seoul');
  await pane.getByRole('combobox', {name: '미리보기 서식'}).selectOption('3.공사표준계약서');
  await pane.getByRole('button', {name: '선택 해제', exact: true}).click();
  for (const name of ['3.공사표준계약서', '7.수의계약 통합서약서', '24.준공계']) await pane.getByRole('checkbox', {name, exact: true}).check();
  await page.evaluate(() => { window.__printCalls = 0; window.print = () => { window.__printCalls++; }; });
  await pane.getByRole('button', {name: '선택 서식 인쇄 / PDF', exact: true}).click();
  await page.waitForFunction(() => window.__printCalls === 1);
  assert(await page.locator('#oneclickPrintRoot .oc-print-page').count() === 3, 'Batch selection not respected');
  await page.emulateMedia({media: 'print'});
  await page.pdf({path: 'C:/obsi/contract/output/playwright/batch-print.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true});
  await page.emulateMedia({media: 'screen'});
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.getByRole('button', {name: '계약 절차 안내', exact: true}).click();
  await page.getByPlaceholder('예: 35000 → 3천5백만원').fill('35000');
  await page.locator('#typeSelect').selectOption('전문');
  await page.getByRole('button', {name: '📊 계약방법 확인', exact: true}).click();
  await page.getByRole('button', {name: '📋 이 방법으로 절차 시작 →', exact: true}).click();
  await page.getByText('계약 구비서류 징구', {exact: true}).click();
  await page.getByText('📁 구비서류 (16)', {exact: true}).click();
  await page.getByRole('button', {name: '원클릭 작성', exact: true}).first().click();
  assert(await pane.getByRole('combobox', {name: '미리보기 서식'}).inputValue() === '3.공사표준계약서', 'Stage handoff failed');
  await page.getByRole('button', {name: '설계용역비 산출', exact: true}).first().click();
  const fee = page.getByRole('region', {name: '설계용역비 산출', exact: true});
  await fee.getByLabel('설계 분야', {exact: true}).selectOption('냉난방');
  await fee.getByLabel('EHP 물량 (대)', {exact: true}).fill('10');
  await fee.getByLabel('GHP 물량 (대)', {exact: true}).fill('10');
  await fee.getByRole('button', {name: '설계용역비 산출', exact: true}).click();
  assert(await fee.locator('.oc-fee-total').count() === 1, 'HVAC calculation failed');
  await fee.getByRole('button', {name: '산출서 인쇄 / PDF', exact: true}).click();
  await page.waitForFunction(() => window.__printCalls === 2);
  assert((await page.locator('#oneclickPrintRoot').innerText()).includes('EHP'), 'HVAC source rows still hidden');
  await page.emulateMedia({media: 'print'});
  await page.pdf({path: 'C:/obsi/contract/output/playwright/hvac-print.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true});
  await page.emulateMedia({media: 'screen'});
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await fee.getByLabel('설계 분야', {exact: true}).selectOption('건축');
  await fee.getByRole('button', {name: '설계용역비 산출', exact: true}).click();
  await fee.getByRole('button', {name: '산출서 인쇄 / PDF', exact: true}).click();
  await page.waitForFunction(() => window.__printCalls === 3);
  await page.emulateMedia({media: 'print'});
  await page.pdf({path: 'C:/obsi/contract/output/playwright/design-fee-print.pdf', format: 'A4', printBackground: true, preferCSSPageSize: true});
  await page.emulateMedia({media: 'screen'});
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.setViewportSize({width: 390, height: 844});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Mobile fee layout overflows');
  await page.setViewportSize({width: 1600, height: 1100});
  await page.evaluate(() => { window.__oneclickFinalVerified = true; });
  return {status: 'PASS', documentPreviews: previews, batchForms: 3, feePrints: ['건축', '냉난방'], stageHandoff: true, mobile: true};
}
