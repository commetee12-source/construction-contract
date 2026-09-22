(function () {
  'use strict';
  const books = window.ONECLICK_BOOKS;
  const Core = window.OneClickCore;
  const STORAGE_KEY = 'cc_oneclick_v1';
  const $ = id => document.getElementById(id);
  const create = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
  const fresh = () => ({version: 1, book: 'construction-seoul', inputs: {construction: {}, design: {}}, edits: {}, selected: {}, fee: {}});
  let saved = fresh(), activeForm, previewTimer, feeResult = null;
  function status(message) { $('oneclickStatus').textContent = message; }
  function validateState(raw) {
    if (!raw || raw.version !== 1 || !raw.inputs || typeof raw.inputs !== 'object') throw new Error('원클릭 입력정보 파일이 아닙니다.');
    const result = fresh();
    if (books[raw.book]?.kind !== 'fee' && Object.hasOwn(books, raw.book)) result.book = raw.book;
    const scalar = v => v === null || (typeof v === 'string' && v.length <= 20000) || (typeof v === 'number' && Number.isFinite(v));
    const fieldValue = (field, val) => {
      if (val === null) return null;
      if (['number', 'percent', 'date'].includes(field.type)) {
        if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) throw new Error(field.label + ' 값이 올바르지 않습니다.');
        if (field.type === 'date' && (val < 1 || val > 2958465 || !Number.isInteger(val))) throw new Error('날짜 값이 올바르지 않습니다.');
        if (field.type === 'percent' && val > 1) throw new Error('요율은 100% 이하여야 합니다.');
        return val;
      }
      if (typeof val !== 'string' || val.length > 2000) throw new Error(field.label + ' 문자 값이 올바르지 않습니다.');
      return val;
    };
    for (const kind of ['construction', 'design']) {
      const fields = books[kind + '-seoul'].fields;
      for (const field of fields) {
        const val = raw.inputs[kind]?.[field.cell];
        if (val !== undefined) result.inputs[kind][field.cell] = fieldValue(field, val);
      }
    }
    for (const book of Object.values(books)) {
      if (book.kind === 'fee') continue;
      result.selected[book.key] = (Array.isArray(raw.selected?.[book.key]) ? raw.selected[book.key] : [book.forms[0]]).filter(name => book.forms.includes(name));
      result.edits[book.key] = {};
      for (const sheet of book.forms) {
        for (const [address, val] of Object.entries(raw.edits?.[book.key]?.[sheet] || {})) {
          const cell = book.sheets[sheet].cells[address];
          if (cell && !cell.f && scalar(val)) {
            result.edits[book.key][sheet] ||= {};
            result.edits[book.key][sheet][address] = val;
          }
        }
      }
    }
    for (const field of feeFields) {
      const val = raw.fee?.[field.key];
      if (val !== undefined) result.fee[field.key] = fieldValue(field, val);
    }
    return result;
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); status('입력정보가 이 브라우저에 저장되었습니다.'); }
    catch { status('브라우저 저장 공간을 사용할 수 없습니다. 입력정보 저장 버튼으로 파일을 보관하세요.'); }
  }
  function button(text, action, primary = false) {
    const b = create('button', primary ? 'oc-primary' : '', text); b.type = 'button'; b.addEventListener('click', action); return b;
  }
  function activate(pane) {
    for (const id of ['workflowPane', 'oneclickPane', 'feePane']) $(id).classList.toggle('hidden', id !== pane);
    document.querySelectorAll('.workspace-tab').forEach(b => { const selected = b.dataset.pane === pane; b.classList.toggle('active', selected); b.setAttribute('aria-pressed', String(selected)); });
  }
  function sourceLink(book) {
    const link = create('a', '', '원본 엑셀'); link.href = book.file; link.download = book.file.split('/').pop(); return link;
  }
  function heading(title, subtitle, book) {
    const node = create('div', 'oc-heading'), text = create('div');
    text.append(create('h2', '', title), create('p', '', subtitle)); node.append(text);
    const actions = create('div', 'oc-actions');
    actions.append(button('입력정보 저장', exportInputs), button('입력정보 불러오기', importInputs), sourceLink(book)); node.append(actions); return node;
  }
  function exportInputs() {
    const blob = new Blob([JSON.stringify(saved, null, 2)], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob), a = create('a');
    a.href = url; a.download = '원클릭_입력정보_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); status('입력정보 파일을 저장했습니다. 업체·계좌 정보가 포함될 수 있습니다.');
  }
  function importInputs() {
    const input = create('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files[0]; if (!file) return;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error('입력정보 파일은 2MB 이하여야 합니다.');
        const imported = validateState(JSON.parse(await file.text()));
        if (!confirm('현재 원클릭 입력정보를 불러온 파일로 바꾸시겠습니까?')) return;
        saved = imported; feeResult = null; persist(); renderDocuments(); renderFee(); status('입력정보를 불러왔습니다.');
      } catch (error) { status('불러오기 실패: ' + error.message); }
    }); input.click();
  }
  function fieldInput(field, id, current, onChange) {
    const wrap = create('div', 'oc-field' + (field.wide ? ' wide' : ''));
    const label = create('label', '', field.label + (field.type === 'percent' ? ' (%)' : ''));
    label.htmlFor = id;
    const control = create(field.options?.length ? 'select' : 'input'); control.id = id;
    if (field.options?.length) {
      const blank = create('option', '', '선택하세요'); blank.value = ''; control.append(blank);
      for (const item of field.options) { const option = create('option', '', item); option.value = field.type === 'percent' ? String(Core.number(item) * 100) : item; control.append(option); }
    } else {
      control.type = field.type === 'date' ? 'date' : ['number', 'percent'].includes(field.type) ? 'number' : 'text';
      if (control.type === 'number') { control.min = '0'; control.step = field.step || (field.type === 'percent' ? '0.001' : '1'); }
      if (control.type === 'text') control.maxLength = 2000;
      control.placeholder = field.placeholder || '';
    }
    let shown = current == null ? '' : field.type === 'date' ? Core.toDateInput(current) : field.type === 'percent' ? String(Number(current) * 100) : String(current);
    if (control.tagName === 'SELECT' && shown !== '' && !Array.from(control.options).some(o => o.value === shown)) { const custom = create('option', '', shown); custom.value = shown; control.append(custom); }
    control.value = shown;
    control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => {
      if (!control.checkValidity()) { onChange(null); return; }
      let val = control.value;
      try {
        if (val === '') val = null;
        else if (field.type === 'date') val = Core.fromDateInput(val);
        else if (field.type === 'percent') val = Core.number(val) / 100;
        else if (field.type === 'number') val = Core.number(val);
        onChange(val);
      } catch (error) { status(error.message); }
    });
    wrap.append(label, control); return wrap;
  }
  function overrides(book) {
    const input = {};
    for (const field of book.fields) input[field.cell] = saved.inputs[book.kind][field.cell] ?? null;
    if (book.kind === 'construction') {
      if (input.C27 == null || input.E28 == null) input.E27 = null;
      if (input.C27 == null || input.E34 == null) input.E35 = null;
      if (input.E30 == null || input.E33 == null) input.E31 = null;
    } else if (input.C22 == null || input.E23 == null) input.E22 = null;
    return {...saved.edits[book.key], '2.데이터입력': input};
  }
  function requiredFields(book) {
    return book.kind === 'construction' ? ['C9', 'C10', 'C19', 'E19', 'C27', 'C28', 'C30', 'C31', 'E28'] : ['C10', 'C11', 'C16', 'E16', 'C22', 'C23', 'C24', 'C25', 'E23'];
  }
  function missingFields(book) { return requiredFields(book).filter(cell => saved.inputs[book.kind][cell] === null || saved.inputs[book.kind][cell] === undefined || saved.inputs[book.kind][cell] === '').map(cell => book.fields.find(f => f.cell === cell)?.label || cell); }
  function checkDates(book) {
    const data = saved.inputs[book.kind], start = data[book.kind === 'construction' ? 'C30' : 'C24'], end = data[book.kind === 'construction' ? 'C31' : 'C25'];
    if (start != null && end != null && end < start) throw new Error('준공기한은 착공·착수일 이후로 입력하세요.');
    const amount = data[book.kind === 'construction' ? 'C27' : 'C22'];
    if (amount != null && (amount <= 0 || !Number.isSafeInteger(amount))) throw new Error('계약금액은 1원 이상의 정수로 입력하세요.');
  }
  function renderDocuments() {
    const pane = $('oneclickPane'), book = books[saved.book]; pane.replaceChildren();
    saved.selected[book.key] ||= [book.forms[0]];
    activeForm = book.forms.includes(activeForm) ? activeForm : book.forms[0];
    pane.append(heading('원클릭 서류 작성', '공통정보를 입력하면 서식에 자동 반영됩니다. 필요한 서식을 선택해 인쇄하거나 PDF로 저장하세요.', book));
    const layout = create('div', 'oc-workspace'), inputPanel = create('div', 'oc-panel'), outputPanel = create('div', 'oc-panel');
    const selector = create('select', 'oc-document-select'); selector.id = 'ocBook'; selector.setAttribute('aria-label', '원클릭 프로그램 선택');
    for (const entry of Object.values(books).filter(b => b.kind !== 'fee')) { const option = create('option', '', entry.title); option.value = entry.key; selector.append(option); }
    selector.value = book.key; selector.addEventListener('change', () => { saved.book = selector.value; persist(); renderDocuments(); });
    inputPanel.append(create('h3', '', '1. 공통정보 입력'), selector);
    const note = create('div', 'oc-note');
    note.append(document.createTextNode('제공된 2026.5 수정본 기준입니다. 원본의 계약보증금 특례 표기는 2026.6.30.까지이며, 이후 연장 여부는 확인되지 않았습니다. 계약일에 적용되는 보증금률을 선택하세요. '));
    const law = create('a', '', '현행 고시 확인'); law.href = 'https://www.law.go.kr/행정규칙/지방자치단체를당사자로하는계약에관한법률시행령의수의계약등한시적특례적용기간에관한고시'; law.target = '_blank'; law.rel = 'noopener'; note.append(law); inputPanel.append(note);
    for (const group of [...new Set(book.fields.map(f => f.group))]) {
      const details = create('details', 'oc-input-group'); details.open = true;
      details.append(create('summary', '', group)); const grid = create('div', 'oc-field-grid');
      for (const field of book.fields.filter(f => f.group === group)) {
        grid.append(fieldInput({...field, wide: /명$|주소/.test(field.label) && !/은행/.test(field.label)}, 'oc_' + field.cell, saved.inputs[book.kind][field.cell], val => {
          saved.inputs[book.kind][field.cell] = val; persist(); clearTimeout(previewTimer); previewTimer = setTimeout(updateDocumentPreview, 160);
        }));
      }
      details.append(grid); inputPanel.append(details);
    }
    const clearActions = create('div', 'oc-actions'); clearActions.style.marginTop = '16px';
    clearActions.append(button('이 업무 입력 초기화', () => {
      if (!confirm('이 업무 유형의 공통 입력정보와 두 기관용 서식 수정내용을 초기화하시겠습니까?')) return;
      saved.inputs[book.kind] = {};
      for (const entry of Object.values(books).filter(b => b.kind === book.kind)) saved.edits[entry.key] = {};
      persist(); renderDocuments();
    })); inputPanel.append(clearActions);
    outputPanel.append(create('h3', '', `2. 서식 선택 · ${book.forms.length}종`));
    const actions = create('div', 'oc-actions');
    actions.append(button('전체 선택', () => { saved.selected[book.key] = [...book.forms]; persist(); renderDocumentList(); }), button('선택 해제', () => { saved.selected[book.key] = []; persist(); renderDocumentList(); }), button('선택 서식 인쇄 / PDF', printDocuments, true));
    outputPanel.append(actions);
    const search = create('input', 'oc-search'); search.id = 'ocSearch'; search.placeholder = '서식 이름 검색'; search.setAttribute('aria-label', '서식 이름 검색'); search.style.marginTop = '12px'; search.addEventListener('input', renderDocumentList); outputPanel.append(search);
    const list = create('div', 'oc-doc-list'); list.id = 'ocDocumentList'; outputPanel.append(list);
    const summary = create('div', 'oc-summary'); summary.id = 'ocSummary'; outputPanel.append(summary);
    const controls = create('div', 'oc-doc-controls'); controls.style.marginTop = '18px';
    const select = create('select', 'oc-document-select'); select.id = 'ocPreviewSelect'; select.setAttribute('aria-label', '미리보기 서식');
    for (const name of book.forms) { const o = create('option', '', name); o.value = name; select.append(o); } select.value = activeForm;
    select.addEventListener('change', () => { activeForm = select.value; updateDocumentPreview(); }); controls.append(select, button('현재 서식 인쇄 / PDF', () => printDocuments([activeForm]))); outputPanel.append(controls);
    outputPanel.append(create('p', 'oc-muted', '공통정보 외의 서식 내용은 미리보기에서 해당 항목을 클릭해 수정할 수 있습니다. 인쇄창의 대상을 ‘PDF로 저장’으로 선택하면 파일로 보관됩니다.'));
    const readiness = create('p', 'oc-muted'); readiness.id = 'ocReadiness'; readiness.style.marginTop = '10px'; outputPanel.append(readiness);
    const preview = create('div', 'oc-preview-frame'); preview.id = 'ocPreview'; outputPanel.append(preview);
    layout.append(inputPanel, outputPanel); pane.append(layout); renderDocumentList(); updateDocumentPreview();
  }
  function renderDocumentList() {
    const book = books[saved.book], list = $('ocDocumentList'); list.replaceChildren();
    const query = $('ocSearch').value.trim().toLowerCase();
    for (const name of book.forms.filter(name => name.toLowerCase().includes(query))) {
      const label = create('label'), check = create('input'); check.type = 'checkbox'; check.checked = saved.selected[book.key].includes(name);
      check.addEventListener('change', () => { const set = new Set(saved.selected[book.key]); check.checked ? set.add(name) : set.delete(name); saved.selected[book.key] = [...set]; persist(); updateDocumentSummary(); });
      label.append(check, document.createTextNode(name)); list.append(label);
    }
    if (!list.children.length) list.append(create('p', 'oc-muted', '일치하는 서식이 없습니다.'));
    updateDocumentSummary();
  }
  function updateDocumentSummary() {
    const book = books[saved.book], summary = $('ocSummary'); if (!summary) return;
    summary.replaceChildren();
    const engine = new Core.Engine(book, overrides(book));
    const deposit = engine.get('2.데이터입력', book.kind === 'construction' ? 'E27' : 'E22');
    for (const [label, val] of [['선택한 서식', saved.selected[book.key].length + '종'], ['계약이행보증금', deposit == null ? '금액·요율 입력 필요' : Core.format(deposit, '#,##0') + '원']]) {
      const item = create('div'); item.append(create('span', '', label), create('strong', '', val)); summary.append(item);
    }
  }
  function sheetElement(book, sheetName, engine, editable = false) {
    const sheet = book.sheets[sheetName], [c1, r1, c2, r2] = Core.bounds(sheet.area);
    const paper = create('div', 'oc-paper');
    const paperWidth = sheet.landscape ? 980 : 690;
    paper.style.width = paperWidth + 'px';
    const table = create('table', 'oc-sheet'); table.setAttribute('aria-label', sheetName);
    const widths = Array.from({length: c2 - c1 + 1}, (_, i) => sheet.widths[String(i + c1)] || 64), totalWidth = widths.reduce((sum, w) => sum + w, 0);
    table.style.width = totalWidth + 'px';
    table.style.zoom = String(paperWidth / totalWidth);
    const cols = create('colgroup'); for (const width of widths) { const col = create('col'); col.style.width = (width / totalWidth * 100) + '%'; cols.append(col); } table.append(cols);
    const origins = new Map(), covered = new Set();
    for (const merge of sheet.merges) {
      const [mc1, mr1, mc2, mr2] = Core.bounds(merge);
      if (mc1 < c1 || mr1 < r1 || mc1 > c2 || mr1 > r2) continue;
      origins.set(Core.colName(mc1) + mr1, [Math.min(mc2, c2) - mc1 + 1, Math.min(mr2, r2) - mr1 + 1, Core.colName(mc2) + mr2]);
      for (let r = mr1; r <= mr2; r++) for (let c = mc1; c <= mc2; c++) if (r !== mr1 || c !== mc1) covered.add(Core.colName(c) + r);
    }
    const tbody = create('tbody');
    for (let row = r1; row <= r2; row++) {
      const dynamicFeeRow = book.kind === 'fee' && sheetName === '설계용역비' && row >= 10 && row <= 15;
      if (dynamicFeeRow) {
        const discipline = engine.get('설계용역비', 'D8');
        if (row <= 13 ? discipline !== '건축' : discipline !== '냉난방') continue;
      } else if (sheet.hiddenRows.includes(row)) continue;
      const tr = create('tr'); tr.style.height = (sheet.heights[String(row)] || 15) + 'pt';
      for (let col = c1; col <= c2; col++) {
        const address = Core.colName(col) + row; if (covered.has(address)) continue;
        const cell = sheet.cells[address] || {}, td = create('td'), definition = book.styles[cell.s] || {css: {}, format: 'General'};
        Object.assign(td.style, definition.css); const merge = origins.get(address);
        if (merge) {
          td.colSpan = merge[0]; td.rowSpan = merge[1];
          const end = sheet.cells[merge[2]], endStyle = end ? book.styles[end.s]?.css : null;
          if (endStyle?.borderBottom) td.style.borderBottom = endStyle.borderBottom;
          if (endStyle?.borderRight) td.style.borderRight = endStyle.borderRight;
        }
        const value = engine.get(sheetName, address);
        const horizontal = typeof value === 'number' && definition.css.textAlign === 'left' && definition.format !== '@' ? 'right' : definition.css.textAlign;
        td.style.textAlign = horizontal;
        const content = create('span', '', Core.format(value, definition.format));
        if (!definition.wrap) {
          let lastColumn = merge ? Math.min(c2, col + merge[0] - 1) : horizontal === 'left' ? c2 : col;
          if (!merge && horizontal === 'left') for (let next = col + 1; next <= c2; next++) {
            const nextCell = sheet.cells[Core.colName(next) + row];
            if (nextCell?.f || nextCell?.v != null) { lastColumn = next - 1; break; }
          }
          const space = widths.slice(col - c1, lastColumn - c1 + 1).reduce((sum, w) => sum + w, 0);
          Object.assign(content.style, {position: 'relative', display: 'block', width: Math.max(1, space - 6) + 'px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', zIndex: '1'});
        }
        td.append(content);
        if (editable && !cell.f && cell.s !== undefined) {
          td.classList.add('oc-editable'); td.tabIndex = 0; td.title = '클릭하여 이 항목 수정';
          if (Object.hasOwn(saved.edits[book.key]?.[sheetName] || {}, address)) td.classList.add('oc-overridden');
          const edit = () => editCell(book, sheetName, address, value);
          td.addEventListener('click', edit); td.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); edit(); } });
        }
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody); paper.append(table); return paper;
  }
  function updateDocumentPreview() {
    const book = books[saved.book], preview = $('ocPreview'); if (!preview) return;
    preview.replaceChildren(); const missing = missingFields(book);
    $('ocReadiness').textContent = missing.length ? '인쇄 전 입력: ' + missing.join(', ') : '공통 필수정보 입력 완료. 서식별 세부 내용을 확인한 뒤 인쇄하세요.';
    try { checkDates(book); preview.append(sheetElement(book, activeForm, new Core.Engine(book, overrides(book)), true)); updateDocumentSummary(); }
    catch (error) { preview.append(create('p', 'oc-error', '미리보기를 계산할 수 없습니다: ' + error.message)); }
  }
  function editCell(book, sheet, address, value) {
    const dialog = $('oneclickEditDialog'); $('oneclickEditValue').value = value ?? '';
    dialog.returnValue = '';
    dialog.onclose = () => {
      if (dialog.returnValue === 'restore') delete saved.edits[book.key]?.[sheet]?.[address];
      else if (dialog.returnValue === 'save') {
        saved.edits[book.key] ||= {}; saved.edits[book.key][sheet] ||= {};
        const text = $('oneclickEditValue').value;
        if (text.length > 20000) { status('서식 항목은 20,000자 이내로 입력하세요.'); return; }
        saved.edits[book.key][sheet][address] = typeof book.sheets[sheet].cells[address].v === 'number' && text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
      } else return;
      persist(); updateDocumentPreview();
    }; dialog.showModal();
  }
  function printDocuments(names) {
    const book = books[saved.book]; if (!Array.isArray(names)) names = saved.selected[book.key];
    const missing = missingFields(book);
    if (missing.length) { status('인쇄 전 입력이 필요합니다: ' + missing.join(', ')); $('ocReadiness').scrollIntoView({behavior: 'smooth', block: 'center'}); return; }
    if (!names.length) { status('인쇄할 서식을 선택하세요.'); return; }
    try { checkDates(book); printSheets(book, names, new Core.Engine(book, overrides(book))); }
    catch (error) { status('인쇄 준비 실패: ' + error.message); }
  }
  function printSheets(book, names, engine) {
    const root = $('oneclickPrintRoot'); root.replaceChildren();
    for (const name of names) { const page = create('div', 'oc-print-page' + (book.sheets[name].landscape ? ' landscape' : '')); page.append(sheetElement(book, name, engine)); root.append(page); }
    document.body.classList.add('oc-printing');
    root.style.display = 'block';
    for (const page of root.children) {
      const paper = page.firstElementChild;
      // Fit short forms; long agreements continue over pages without tiny text.
      const height = paper.scrollHeight, width = paper.scrollWidth;
      const maxHeight = page.classList.contains('landscape') ? 680 : 1000;
      const maxWidth = page.classList.contains('landscape') ? 1000 : 703;
      const fitHeight = height <= maxHeight * 1.45 ? maxHeight / height : 0.95;
      paper.style.zoom = String(Math.min(1, fitHeight, maxWidth / width));
    }
    root.style.removeProperty('display');
    requestAnimationFrame(() => window.print());
  }
  window.addEventListener('afterprint', () => { document.body.classList.remove('oc-printing'); $('oneclickPrintRoot').replaceChildren(); });
  const feeFields = [
    {key: 'name', cell: 'D4', label: '용역명', type: 'text', wide: true},
    {key: 'discipline', cell: 'D8', label: '설계 분야', options: ['건축', '토목', '설비', '전기', '통신', '냉난방'], default: '건축'},
    {key: 'budget', cell: 'G8', label: '총 예산액 (원)', type: 'number', placeholder: '예: 100000000'},
    {key: 'supervision', cell: 'D21', label: '추정 감리비 (원)', type: 'number', default: 0},
    {key: 'insurance', cell: 'F45', label: '손해배상보험·공제 요율', type: 'percent', step: '0.001'},
    {key: 'planning', cell: 'E10', label: '계획설계 수준', options: ['미반영', '기본', '중급'], default: '미반영', group: 'architecture'},
    {key: 'intermediate', cell: 'E11', label: '중간설계 수준', options: ['미반영', '기본', '중급'], default: '미반영', group: 'architecture'},
    {key: 'detail', cell: 'E12', label: '실시설계 수준', options: ['기본', '중급', '상급'], default: '기본', group: 'architecture'},
    {key: 'remodel', cell: 'E13', label: '리모델링·인테리어 가산', options: ['미적용', '적용'], default: '미적용', group: 'architecture'},
    {key: 'ehp', cell: 'E14', label: 'EHP 물량 (대)', type: 'number', default: 0, group: 'hvac'},
    {key: 'ghp', cell: 'E15', label: 'GHP 물량 (대)', type: 'number', default: 0, group: 'hvac'},
    {key: 'nature', sheet: '서울교육청 기준 산출서', cell: 'AU22', label: '공사성격 보정계수', type: 'number', step: '0.01', default: 1, group: 'hvac'},
    {key: 'bim', sheet: '서울교육청 기준 산출서', cell: 'AU23', label: 'BIM 보정계수', type: 'number', step: '0.01', default: 1, group: 'hvac'},
    {key: 'bems', sheet: '서울교육청 기준 산출서', cell: 'AU24', label: 'BEMS 보정계수', type: 'number', step: '0.01', default: 1, group: 'hvac'},
    {key: 'usage', sheet: '서울교육청 기준 산출서', cell: 'AU25', label: '건물용도 보정계수', type: 'number', step: '0.01', default: 0.93, group: 'hvac'},
    ...['기술사', '특급', '고급', '중급', '초급'].map((grade, i) => ({key: 'labor' + i, sheet: '서울교육청 기준 산출서', cell: 'AT' + (29 + i), label: grade + ' 노임단가 (원/일)', type: 'number', default: [474497, 401407, 335379, 300463, 263602][i], group: 'hvac'}))
  ];
  function feeOverrides() {
    const result = {};
    for (const field of feeFields) { const sheet = field.sheet || '설계용역비'; result[sheet] ||= {}; result[sheet][field.cell] = saved.fee[field.key] ?? field.default ?? null; }
    return result;
  }
  function renderFee() {
    const pane = $('feePane'), book = books['design-fee']; pane.replaceChildren();
    pane.append(heading('설계용역비 산출', '원본 프로그램의 요율표·직선보간·예산 배분 반복 계산을 반영했습니다.', book));
    const layout = create('div', 'oc-workspace'), inputs = create('div', 'oc-panel'), output = create('div', 'oc-panel');
    inputs.append(create('h3', '', '산출 조건'));
    const grid = create('div', 'oc-field-grid');
    for (const field of feeFields) {
      const wrap = fieldInput(field, 'fee_' + field.key, saved.fee[field.key] ?? field.default, val => {
        saved.fee[field.key] = val; feeResult = null; persist(); updateFeeGroups(); $('ocFeeResult').replaceChildren(create('p', 'oc-muted', '입력조건이 변경되었습니다. 다시 산출하세요.'));
      }); if (field.group) wrap.dataset.feeGroup = field.group; grid.append(wrap);
    }
    inputs.append(grid);
    const note = create('div', 'oc-note', '2026.5 원본에 수록된 요율·노임단가 기준입니다. 냉난방의 기본 노임단가는 원본의 2025년 값이며 수정할 수 있습니다. 보험·공제 요율은 적용할 값을 직접 입력하세요.'); inputs.append(note);
    const actions = create('div', 'oc-actions'); actions.append(button('설계용역비 산출', calculateFee, true), sourceLink(book)); inputs.append(actions);
    output.append(create('h3', '', '산출 결과'));
    const result = create('div'); result.id = 'ocFeeResult'; result.append(create('p', 'oc-muted', '예산과 산출 조건을 입력한 뒤 ‘설계용역비 산출’을 누르세요.')); output.append(result);
    const reference = create('details', 'oc-input-group'); reference.append(create('summary', '', '요율·보정계수 참고자료'));
    const refSelect = create('select', 'oc-document-select'); refSelect.setAttribute('aria-label', '산출 참고자료');
    for (const name of ['용역손해배상보험,공제 관련', '기계설비 산정기준', '환산계수,보정계수', '서울교육청 기준 산출서']) { const option = create('option', '', name); option.value = name; refSelect.append(option); }
    const refPreview = create('div', 'oc-preview-frame');
    const showReference = () => { refPreview.replaceChildren(); try { refPreview.append(sheetElement(book, refSelect.value, new Core.Engine(book, feeOverrides()))); } catch (e) { refPreview.append(create('p', 'oc-error', e.message)); } };
    refSelect.addEventListener('change', showReference); reference.addEventListener('toggle', () => { if (reference.open) showReference(); }); reference.append(refSelect, refPreview); output.append(reference);
    layout.append(inputs, output); pane.append(layout); updateFeeGroups();
  }
  function updateFeeGroups() {
    const discipline = saved.fee.discipline ?? '건축';
    document.querySelectorAll('[data-fee-group]').forEach(el => el.classList.toggle('hidden', el.dataset.feeGroup === 'architecture' ? discipline !== '건축' : discipline !== '냉난방'));
  }
  function calculateFee() {
    const output = $('ocFeeResult'); output.replaceChildren();
    try {
      for (const input of $('feePane').querySelectorAll('input')) if (!input.closest('.hidden') && !input.checkValidity()) { input.reportValidity(); throw new Error('입력값을 확인하세요.'); }
      if (saved.fee.insurance == null || saved.fee.insurance < 0 || saved.fee.insurance > 1) throw new Error('보험·공제 요율을 0% 이상 100% 이하로 입력하세요.');
      if (!saved.fee.budget) throw new Error('총 예산액을 입력하세요.');
      const book = books['design-fee']; feeResult = Core.solveFee(book, feeOverrides());
      const result = feeResult, summary = create('div', 'oc-fee-total'); summary.append(create('span', '', '설계용역비 합계'), create('strong', '', Core.format(result.total, '#,##0') + '원'), create('p', 'oc-muted', '보험·공제 및 부가가치세 포함 · 원본의 절사·가산 순서 적용')); output.append(summary);
      const table = create('table', 'oc-breakdown');
      for (const [label, value] of [['용역대상 공사비 (부가세 제외)', result.engine.get('설계용역비', 'D22')], ['설계비', result.engine.get('설계용역비', 'G44')], ['보험·공제료', result.engine.get('설계용역비', 'G45')], ['부가가치세', result.engine.get('설계용역비', 'G46')], ['설계비 배분액', result.allocated]]) { const tr = create('tr'); tr.append(create('td', '', label), create('td', '', Core.format(value, '#,##0.##') + '원')); table.append(tr); }
      output.append(table);
      const actions = create('div', 'oc-actions'); actions.append(button('산출서 인쇄 / PDF', () => { if (feeResult) printSheets(book, ['설계용역비'], feeResult.engine); }, true), button('설계용역 서류에 금액 반영', () => {
        saved.inputs.design.C22 = result.total; saved.inputs.design.C10 = saved.fee.name || saved.inputs.design.C10 || null;
        saved.book = 'design-seoul'; persist(); renderDocuments(); activate('oneclickPane'); status('산출금액과 용역명을 설계용역 공통정보에 반영했습니다.');
      })); output.append(actions);
      const preview = create('div', 'oc-preview-frame'); preview.append(sheetElement(book, '설계용역비', result.engine)); output.append(preview); status('설계용역비 산출이 완료되었습니다.');
    } catch (error) { feeResult = null; output.append(create('p', 'oc-error', error.message)); status('산출 조건을 확인하세요.'); }
  }
  // Existing stage pages can open the matching original Excel-derived document.
  window.openOneClickDocument = function (title) {
    saved.book = saved.book.startsWith('construction') ? saved.book : 'construction-seoul';
    const normalized = text => text.replace(/[\s·ㆍ,().+]/g, '').replace(/^\d+/, '');
    const form = books[saved.book].forms.find(name => normalized(name).includes(normalized(title)) || normalized(title).includes(normalized(name)));
    activeForm = form || books[saved.book].forms[0]; renderDocuments(); activate('oneclickPane'); $('oneclickPane').scrollIntoView({behavior: 'smooth', block: 'start'});
  };
  const normalizeFormName = text => text.replace(/[\s·ㆍ,().+]/g, '').replace(/^\d+/, '');
  window.hasOneClickDocument = function (title) {
    const wanted = normalizeFormName(title);
    return books['construction-seoul'].forms.some(name => normalizeFormName(name) === wanted);
  };
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-oneclick-document]');
    if (trigger) window.openOneClickDocument(decodeURIComponent(trigger.dataset.oneclickDocument));
  });
  try { const stored = localStorage.getItem(STORAGE_KEY); if (stored) saved = validateState(JSON.parse(stored)); }
  catch { status('저장된 원클릭 입력정보를 읽지 못했습니다. 입력정보 파일을 불러오거나 새로 입력하세요.'); }
  document.querySelectorAll('.workspace-tab').forEach(tab => tab.addEventListener('click', () => activate(tab.dataset.pane)));
  renderDocuments(); renderFee();
})();
