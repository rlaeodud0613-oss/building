const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');

async function nav(page, name) {
  await page.locator('#nav').getByRole('button', { name, exact: true }).click();
  await expect(page.locator('#pageTitle')).toHaveText(name);
}
async function addStudent(page, name = '가상수련생') {
  await page.getByRole('button', { name: '+ 수련생 추가', exact: true }).click();
  const dialog = page.locator('#studentDialog');
  await dialog.getByLabel('이름', { exact: true }).fill(name);
  await dialog.getByLabel('등록일', { exact: true }).fill('2020-01-01');
  // Synthetic student attends every weekday, including weekends, for date-independent tests.
  for (const n of ['일', '토']) await dialog.getByLabel(n, { exact: true }).check();
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
async function downloadBackup(page) {
  await nav(page, '설정 · 백업');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '전체 JSON 백업', exact: true }).click();
  const file = await download;
  const data = await fs.readFile(await file.path(), 'utf8');
  return { data, parsed: JSON.parse(data) };
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/');
  await expect(page.locator('#pageTitle')).toHaveText('운영 대시보드');
});

test('all screens fit the viewport and make no external requests', async ({ page }, testInfo) => {
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', request => {
    if (!request.url().startsWith('http://127.0.0.1:8765') && !request.url().startsWith('blob:')) external.push(request.url());
  });
  await addStudent(page);
  for (const name of ['출석 관리', '수련생 관리', '회비 관리', '상담 CRM', '장기결석', '학부모 메시지', '운영 리포트', '설정 · 백업', '운영 대시보드']) {
    await nav(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  await nav(page, '출석 관리');
  // The attendance actions must remain usable inside a scrolling table on narrow screens.
  await page.getByRole('button', { name: '가상수련생 출석', exact: true }).click();
  await expect(page.locator('#view .tag')).toHaveText('출석');
  await page.screenshot({ path: testInfo.outputPath('attendance.png'), fullPage: true });
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('student persists through reload, attendance corrects and cancels', async ({ page }) => {
  await addStudent(page);
  await page.reload();
  await nav(page, '수련생 관리');
  await expect(page.locator('#view')).toContainText('가상수련생');
  await page.getByRole('button', { name: '수정', exact: true }).click();
  await page.locator('#studentDialog').getByLabel('이름', { exact: true }).fill('가상학생수정');
  await page.locator('#studentDialog').getByRole('button', { name: '저장', exact: true }).click();
  await nav(page, '출석 관리');
  await page.getByRole('button', { name: '가상학생수정 결석', exact: true }).click();
  await expect(page.locator('#view .tag')).toHaveText('결석');
  await page.getByRole('button', { name: '가상학생수정 지각', exact: true }).click();
  await expect(page.locator('#view .tag')).toHaveText('지각');
  await page.getByRole('button', { name: '취소', exact: true }).click();
  await expect(page.locator('#view .tag')).toHaveText('미체크');
  await page.getByLabel('자연어 운영 명령').fill('가상학생수정 출석 처리');
  await page.locator('#runCommandBtn').click();
  await expect(page.locator('#assistantAnswer')).toContainText('출석 기록 완료');
  await expect(page.locator('#view .tag')).toHaveText('출석');
});

test('billing is idempotent, partial payment creates an editable draft', async ({ page }) => {
  await addStudent(page);
  await nav(page, '회비 관리');
  await page.getByRole('button', { name: '재원생 청구 생성', exact: true }).click();
  await page.getByRole('button', { name: '재원생 청구 생성', exact: true }).click();
  await expect(page.locator('#view tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: '장부 수정', exact: true }).click();
  await page.getByLabel('누적 수납액', { exact: true }).fill('50000');
  await page.locator('#editorDialog').getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#view')).toContainText('잔액 100,000원');
  await page.getByRole('button', { name: '안내 초안', exact: true }).click();
  await expect(page.locator('#pageTitle')).toHaveText('학부모 메시지');
  await expect(page.locator('[data-draft]')).toContainText('100,000원');
  await page.locator('[data-draft]').fill('가상 테스트용 회비 안내 초안');
  await page.getByRole('button', { name: '수정 저장', exact: true }).click();
  const { parsed } = await downloadBackup(page);
  expect(parsed.payments[0].paid).toBe(50000);
  expect(parsed.drafts[0].text).toBe('가상 테스트용 회비 안내 초안');
  expect(parsed.drafts[0].status).toBe('draft');
});

test('consultation converts to a student without losing the lead', async ({ page }) => {
  await nav(page, '상담 CRM');
  await page.getByRole('button', { name: '+ 상담 등록', exact: true }).click();
  await page.locator('#editorDialog').getByLabel('이름', { exact: true }).fill('가상상담자');
  await page.getByLabel('단계', { exact: true }).selectOption('체험완료');
  await page.locator('#editorDialog').getByRole('button', { name: '저장', exact: true }).click();
  await page.getByRole('button', { name: '수련생 등록', exact: true }).click();
  await page.locator('#studentDialog').getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.locator('#view')).toContainText('등록완료');
  const { parsed } = await downloadBackup(page);
  expect(parsed.leads).toHaveLength(1);
  expect(parsed.students[0].name).toBe('가상상담자');
  expect(parsed.leads[0].stage).toBe('등록완료');
});

test('backup download, validated restore, previous snapshot, invalid file refusal', async ({ page }) => {
  await addStudent(page);
  const original = await downloadBackup(page);
  const restored = structuredClone(original.parsed);
  restored.students[0].name = '복원용가상학생';
  await page.locator('#restoreFile').setInputFiles({ name: 'synthetic-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(restored)) });
  await expect(page.locator('#restorePreview')).toContainText('수련생 1명');
  await page.getByRole('button', { name: '확인 후 복원 적용', exact: true }).click();
  await expect(page.locator('#assistantAnswer')).toContainText('복원을 완료');
  const previousDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '복원 전 사본 다운로드', exact: true }).click();
  const previous = await fs.readFile(await (await previousDownload).path(), 'utf8');
  expect(JSON.parse(previous)).toEqual(original.parsed);
  await page.locator('#restoreFile').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.locator('#restorePreview')).toContainText('복원할 수 없는 파일');
  await expect(page.getByRole('button', { name: '확인 후 복원 적용', exact: true })).toHaveCount(0);
  await nav(page, '수련생 관리');
  await expect(page.locator('#view')).toContainText('복원용가상학생');
});

test('reports use the selected period and export text', async ({ page }) => {
  await addStudent(page);
  await nav(page, '출석 관리');
  await page.getByRole('button', { name: '가상수련생 출석', exact: true }).click();
  await nav(page, '운영 리포트');
  for (const [value, label] of [['day', '일일'], ['week', '주간'], ['month', '월간']]) {
    await page.getByLabel('기간', { exact: true }).selectOption(value);
    await expect(page.locator('.report')).toContainText(label+' 운영 리포트');
    await expect(page.locator('.report')).toContainText('출석 1건');
  }
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '텍스트 다운로드', exact: true }).click();
  const text = await fs.readFile(await (await download).path(), 'utf8');
  expect(text).toContain('월간 운영 리포트');
});
