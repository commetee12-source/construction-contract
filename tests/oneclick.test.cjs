const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../assets/oneclick-core.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../assets/oneclick-data.js'), 'utf8'), sandbox);
const books = sandbox.window.ONECLICK_BOOKS;

test('Korean amounts and date formatting retain units and leap-day behavior', () => {
  assert.equal(core.koreanNumber(123456789), '일억이천삼백사십오만육천칠백팔십구');
  assert.equal(core.koreanNumber(100000000), '일억');
  assert.equal(core.koreanNumber(0), '영');
  assert.equal(core.toDateInput(core.fromDateInput('2026-09-22')), '2026-09-22');
  assert.equal(core.format(100000000, '#,##0'), '100,000,000');
  assert.equal(core.format(0.05, '0.0%'), '5.0%');
  assert.equal(core.format(core.fromDateInput('2026-09-22'), 'yyyy년 mm월 dd일'), '2026년 09월 22일');
});

test('parser handles precedence, lazy conditionals, blank cells and lookup errors', () => {
  const engine = new core.Engine({sheets: {Sheet1: {cells: {A1: {v: 10}, A2: {v: 20}, B1: {v: 0.1}, B2: {v: 0.2}}}}});
  assert.equal(engine.formula('=2+3*4', 'Sheet1'), 14);
  assert.equal(engine.formula('=IF(1<2,"정상",1/0)', 'Sheet1'), '정상');
  assert.equal(engine.formula('=SUM(A1:A2)', 'Sheet1'), 30);
  assert.equal(engine.formula('=VLOOKUP(20,A1:B2,2,0)', 'Sheet1'), 0.2);
  assert.equal(engine.formula('=IFERROR(1/0,9)', 'Sheet1'), 9);
  assert.equal(engine.formula('=TRUNC(123456,-3)', 'Sheet1'), 123000);
  assert.equal(engine.formula('=ROUND(-1.5,0)', 'Sheet1'), -2);
  assert.throws(() => engine.formula('=UNKNOWN(1)', 'Sheet1'), /지원하지/);
  assert.throws(() => engine.formula('=VLOOKUP(99,A1:B2,2,0)', 'Sheet1'));
});

test('all four document books update common data, deposits, dates and document text', () => {
  for (const book of Object.values(books).filter(book => book.kind !== 'fee')) {
    const construction = book.kind === 'construction';
    const amountCell = construction ? 'C27' : 'C22';
    const rateCell = construction ? 'E28' : 'E23';
    const nameCell = construction ? 'C9' : 'C10';
    const overrides = {'2.데이터입력': {[amountCell]: 123456789, [rateCell]: 0.1, [nameCell]: '검증용 시설개선 사업'}};
    const engine = new core.Engine(book, overrides);
    assert.equal(engine.get('2.데이터입력', construction ? 'E27' : 'E22'), 12345670);
    const text = Object.entries(book.sheets[book.forms[0]].cells).map(([address]) => engine.get(book.forms[0], address)).join(' ');
    assert.match(text, /검증용 시설개선 사업/);
    assert.match(text, /123,456,789/);
    if (construction) {
      overrides['2.데이터입력'].E30 = core.fromDateInput('2024-02-29');
      overrides['2.데이터입력'].E33 = 1;
      const changed = new core.Engine(book, overrides);
      assert.equal(core.toDateInput(changed.get('2.데이터입력', 'E31')), '2025-02-27');
    }
    assert.ok(book.forms.every(name => !name.includes('삭제')));
  }
});

test('every formula in printable documents evaluates, including water and electricity', () => {
  for (const book of Object.values(books).filter(book => book.kind !== 'fee')) {
    const engine = new core.Engine(book);
    for (const sheet of book.forms) {
      for (const [address, cell] of Object.entries(book.sheets[sheet].cells)) {
        if (cell.f) assert.doesNotThrow(() => engine.get(sheet, address), `${book.key} ${sheet}!${address}: ${cell.f}`);
      }
    }
  }
});

test('design fee iteration returns first 0.01% budget-share crossing for each discipline', () => {
  const book = books['design-fee'];
  for (const discipline of ['건축', '토목', '설비', '전기', '통신', '냉난방']) {
    const overrides = {'설계용역비': {D8: discipline, G8: 100000000, E10: '미반영', E11: '미반영', E12: '기본', E13: '미적용', E14: 10, E15: 10, D21: 0, F45: 0.01012}};
    const result = core.solveFee(book, overrides);
    assert.ok(result.total > 0 && result.total < 100000000, discipline);
    assert.ok(result.allocated > result.total, discipline);
    const previous = new core.Engine(book, {...overrides, '설계용역비': {...overrides['설계용역비'], F19: (result.steps - 1) / 10000}});
    assert.ok(previous.get('설계용역비', 'D49') >= previous.get('설계용역비', 'D19'), discipline);
    assert.equal(result.total % 1000, 0);
  }
});

test('invalid fee inputs and impossible budgets fail explicitly', () => {
  const book = books['design-fee'];
  assert.throws(() => core.solveFee(book, {'설계용역비': {G8: 0}}), /예산/);
  assert.throws(() => core.solveFee(book, {'설계용역비': {G8: null}}), /예산/);
  assert.throws(() => core.solveFee(book, {'설계용역비': {G8: 100000000, D21: 100000001}}), /감리비/);
  assert.throws(() => core.solveFee(book, {'설계용역비': {G8: 1000, D8: '냉난방', E14: 100, E15: 100}}));
});

test('architectural fee reproduces a separately checked reference calculation', () => {
  const result = core.solveFee(books['design-fee'], {'설계용역비': {D8: '건축', G8: 100000000, D21: 0, E10: '미반영', E11: '미반영', E12: '기본', E13: '미적용', F45: 0.01012}});
  // 0.0347 budget allocation gives 87,754,000 KRW before VAT.
  // Between 50m / 100m, the truncated 3.80 / 3.47 rates interpolate to 3.55%.
  assert.equal(result.steps, 347);
  assert.equal(result.engine.get('설계용역비', 'D22'), 87754000);
  assert.equal(result.engine.get('설계용역비', 'F40'), 3.55);
  assert.equal(result.engine.get('설계용역비', 'G44'), 3115266);
  assert.equal(result.total, 3461000);
});

test('design affidavits use the current service company, representative, agency and date', () => {
  for (const key of ['design-seoul', 'design-other']) {
    const date = core.fromDateInput('2026-09-22');
    const engine = new core.Engine(books[key], {'2.데이터입력': {C16: '새설계사', E16: '새대표', C11: '새초등학교', C23: date}});
    assert.equal(engine.get('9.수의계약 각서', 'H51'), '새설계사');
    assert.equal(engine.get('9.수의계약 각서', 'J51'), '새대표  (인)');
    assert.equal(engine.get('9.수의계약 각서', 'C52'), '새초등학교장 귀하');
    assert.equal(engine.get('9.수의계약 각서', 'C50'), date);
  }
});
