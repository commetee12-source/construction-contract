/* Offline calculation support for the supplied one-click workbooks. No eval/VBA. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OneClickCore = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const DAY = 86400000;
  const EPOCH = Date.UTC(1899, 11, 30);
  const number = value => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'boolean') return value ? 1 : 0;
    const result = typeof value === 'string' && value.trim().endsWith('%') ? Number(value.slice(0, -1)) / 100 : Number(value);
    if (!Number.isFinite(result)) throw new Error('숫자로 계산할 수 없는 값입니다.');
    return result;
  };
  const string = value => value === null || value === undefined ? '' : String(value);
  const serialDate = value => new Date(EPOCH + Math.round(number(value)) * DAY);
  function fromDateInput(value) {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('날짜 형식이 올바르지 않습니다.');
    const timestamp = Date.parse(value + 'T00:00:00Z');
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error('유효한 날짜를 입력하세요.');
    return Math.round((timestamp - EPOCH) / DAY);
  }
  function toDateInput(value) {
    return value === null || value === '' ? '' : serialDate(value).toISOString().slice(0, 10);
  }
  function koreanNumber(value) {
    let n = Math.trunc(number(value));
    if (!Number.isSafeInteger(n)) throw new Error('지원하는 금액 범위를 초과했습니다.');
    if (n === 0) return '영';
    const sign = n < 0 ? '마이너스 ' : '';
    n = Math.abs(n);
    const digits = '영일이삼사오육칠팔구';
    const units = ['', '만', '억', '조'];
    const groups = [];
    for (let group = 0; n > 0; group += 1) {
      let part = n % 10000;
      n = Math.floor(n / 10000);
      let text = '';
      for (let p = 0; p < 4; p += 1) {
        const digit = part % 10;
        part = Math.floor(part / 10);
        if (digit) text = (digit === 1 && p > 0 ? '' : digits[digit]) + ['', '십', '백', '천'][p] + text;
      }
      if (text) groups.unshift(text + units[group]);
    }
    return sign + groups.join('');
  }
  function format(value, code = 'General') {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value !== 'number') return string(value);
    let fmt = String(code).split(';')[value < 0 ? 1 : value === 0 ? 2 : 0] || String(code).split(';')[0];
    if (/DBNum[14]/i.test(fmt)) return koreanNumber(value);
    fmt = fmt.replace(/\[[^\]]*\]/g, '').replace(/_.|\*./g, '').replace(/\\(.)/g, '$1').replace(/"([^"]*)"/g, '$1');
    if (/y{2,4}/i.test(fmt) || (/m{1,4}/i.test(fmt) && /d{1,4}/i.test(fmt))) {
      const date = serialDate(value);
      const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1, d = date.getUTCDate();
      return fmt.replace(/yyyy|yy|mm|m|dd|d/gi, part => ({yyyy: String(y), yy: String(y).slice(-2), mm: String(m).padStart(2, '0'), m: String(m), dd: String(d).padStart(2, '0'), d: String(d)})[part.toLowerCase()]);
    }
    if (/General|G\/표준|^@$/i.test(fmt)) return String(value);
    const match = fmt.match(/[#0][#0,]*(?:\.[#0]+)?%?/);
    if (!match) return String(value);
    const decimals = (match[0].split('.')[1] || '').replace('%', '');
    const shown = (match[0].endsWith('%') ? value * 100 : value);
    const text = shown.toLocaleString('en-US', {useGrouping: match[0].includes(','), minimumFractionDigits: (decimals.match(/0/g) || []).length, maximumFractionDigits: decimals.length});
    return fmt.slice(0, match.index) + text + (match[0].endsWith('%') ? '%' : '') + fmt.slice(match.index + match[0].length);
  }
  function colNumber(text) { return [...text.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0); }
  function colName(n) { let s = ''; while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; }
  function addressParts(ref) {
    const match = String(ref).replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/i);
    if (!match) throw new Error('셀 주소를 확인하세요: ' + ref);
    return [colNumber(match[1]), Number(match[2])];
  }
  function bounds(area) {
    const parts = area.split(':');
    return [...addressParts(parts[0]), ...addressParts(parts[1] || parts[0])];
  }
  function tokenize(source) {
    const tokens = [];
    let rest = source.replace(/^=/, '');
    while (rest.length) {
      if (/^\s/.test(rest)) { rest = rest.replace(/^\s+/, ''); continue; }
      let match;
      if ((match = rest.match(/^"((?:[^"]|"")*)"/))) tokens.push({type: 'literal', value: match[1].replace(/""/g, '"')});
      else if ((match = rest.match(/^'((?:[^']|'')+)'!/))) tokens.push({type: 'sheet', value: match[1].replace(/''/g, "'")});
      else if ((match = rest.match(/^([^\s'"()+*\/,<>=&^%:!]+)!/))) tokens.push({type: 'sheet', value: match[1]});
      else if ((match = rest.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?/i))) tokens.push({type: 'literal', value: Number(match[0])});
      else if ((match = rest.match(/^\$?[A-Z]{1,3}\$?\d+(?![\w])/i))) tokens.push({type: 'ref', value: match[0].replace(/\$/g, '').toUpperCase()});
      else if ((match = rest.match(/^[A-Z_][A-Z0-9_.]*/i))) tokens.push({type: 'name', value: match[0].toUpperCase()});
      else if ((match = rest.match(/^(?:<>|<=|>=|[+\-*/^&=<>%():,])/))) tokens.push({type: match[0]});
      else throw new Error('지원하지 않는 수식 표현: ' + rest.slice(0, 40));
      rest = rest.slice(match[0].length);
    }
    tokens.push({type: 'end'});
    return tokens;
  }
  const precedence = {'=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5};
  function parse(source) {
    const tokens = tokenize(source);
    let index = 0;
    const take = type => { const token = tokens[index++]; if (type && token.type !== type) throw new Error('수식 문법 오류: ' + source); return token; };
    function expr(min = 0) {
      let first = take(), node;
      if (first.type === '+' || first.type === '-') node = {kind: 'unary', op: first.type, value: expr(5)};
      else if (first.type === '(') { node = expr(); take(')'); }
      else if (first.type === 'literal') node = {kind: 'literal', value: first.value};
      else if (first.type === 'ref' || first.type === 'sheet') {
        node = {kind: 'ref', sheet: first.type === 'sheet' ? first.value : null, address: first.type === 'ref' ? first.value : take('ref').value};
        if (tokens[index].type === ':') { take(':'); node.end = take('ref').value; }
      } else if (first.type === 'name') {
        if (first.value === 'TRUE' || first.value === 'FALSE') node = {kind: 'literal', value: first.value === 'TRUE'};
        else {
          take('('); const args = [];
          if (tokens[index].type !== ')') {
            do { args.push(tokens[index].type === ',' || tokens[index].type === ')' ? {kind: 'literal', value: null} : expr()); if (tokens[index].type !== ',') break; take(','); } while (true);
          }
          take(')'); node = {kind: 'call', name: first.value, args};
        }
      } else throw new Error('수식 문법 오류: ' + source);
      while (tokens[index].type === '%') { take('%'); node = {kind: 'unary', op: '%', value: node}; }
      while ((precedence[tokens[index].type] || 0) > min) {
        const op = take().type;
        node = {kind: 'binary', op, left: node, right: expr(precedence[op])};
      }
      return node;
    }
    const result = expr(); take('end'); return result;
  }
  const astCache = new Map();
  function rounded(value, digits, truncate = false) {
    const n = number(value), factor = 10 ** number(digits);
    const scaled = Math.abs(n) * factor;
    const result = truncate ? Math.floor(scaled + Number.EPSILON * Math.max(1, scaled) * 2) : Math.floor(scaled + 0.5 + Number.EPSILON * Math.max(1, scaled));
    return Math.sign(n) * result / factor;
  }
  class Engine {
    constructor(book, overrides = {}) { this.book = book; this.overrides = overrides; this.cache = new Map(); this.visiting = new Set(); }
    get(sheet, address) {
      address = address.replace(/\$/g, '');
      if (Object.hasOwn(this.overrides[sheet] || {}, address)) return this.overrides[sheet][address];
      const key = sheet + '!' + address;
      if (this.cache.has(key)) return this.cache.get(key);
      if (this.visiting.has(key)) throw new Error('순환참조: ' + key);
      if (!this.book.sheets[sheet]) throw new Error('시트를 찾을 수 없습니다: ' + sheet);
      const cell = this.book.sheets[sheet].cells[address];
      if (!cell) return null;
      this.visiting.add(key);
      try {
        const value = cell.f ? this.formula(cell.f, sheet) : cell.v ?? null;
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('계산 범위를 확인하세요: ' + key);
        this.cache.set(key, value); return value;
      } finally { this.visiting.delete(key); }
    }
    formula(source, sheet) {
      if (!astCache.has(source)) astCache.set(source, parse(source));
      return this.evaluate(astCache.get(source), sheet);
    }
    evaluate(node, sheet) {
      const evaluate = child => this.evaluate(child, sheet);
      if (node.kind === 'literal') return node.value;
      if (node.kind === 'ref') {
        if (!node.end) return this.get(node.sheet || sheet, node.address);
        const [c1, r1, c2, r2] = bounds(node.address + ':' + node.end), rows = [];
        for (let r = r1; r <= r2; r++) { const row = []; for (let c = c1; c <= c2; c++) row.push(this.get(node.sheet || sheet, colName(c) + r)); rows.push(row); }
        return rows;
      }
      if (node.kind === 'unary') { const v = number(evaluate(node.value)); return node.op === '-' ? -v : node.op === '%' ? v / 100 : v; }
      if (node.kind === 'binary') {
        const a = evaluate(node.left), b = evaluate(node.right);
        if (node.op === '&') return string(a) + string(b);
        if (node.op === '=') return a === b || (a == null && (b === '' || b === 0)) || (b == null && (a === '' || a === 0));
        if (node.op === '<>') return !(a === b || (a == null && (b === '' || b === 0)) || (b == null && (a === '' || a === 0)));
        if (node.op === '<') return a < b;
        if (node.op === '>') return a > b;
        if (node.op === '<=') return a <= b;
        if (node.op === '>=') return a >= b;
        const x = number(a), y = number(b);
        switch (node.op) {
          case '+': return x + y; case '-': return x - y; case '*': return x * y;
          case '/': if (y === 0) throw new Error('0으로 나눌 수 없습니다.'); return x / y;
          case '^': return x ** y;
        }
      }
      if (node.kind !== 'call') throw new Error('수식을 처리할 수 없습니다.');
      if (node.name === 'IF') return evaluate(node.args[0]) ? evaluate(node.args[1]) : node.args.length > 2 ? evaluate(node.args[2]) : false;
      if (node.name === 'IFERROR') { try { return evaluate(node.args[0]); } catch { return evaluate(node.args[1]); } }
      const args = node.args.map(evaluate), [a, b, c, d] = args;
      switch (node.name) {
        case 'SUM': return args.flat(Infinity).filter(v => typeof v === 'number').reduce((sum, v) => sum + v, 0);
        case 'AND': return args.flat(Infinity).every(Boolean);
        case 'OR': return args.flat(Infinity).some(Boolean);
        case 'INT': return Math.floor(number(a));
        case 'TRUNC': case 'ROUNDDOWN': return rounded(a, b ?? 0, true);
        case 'ROUND': return rounded(a, b ?? 0);
        case 'TEXT': return format(a, b);
        case 'NUMBERSTRING': return koreanNumber(a);
        case 'LEFT': return string(a).slice(0, b == null ? 1 : number(b));
        case 'RIGHT': { const length = b == null ? 1 : number(b); return length ? string(a).slice(-length) : ''; }
        case 'YEAR': return a == null ? null : serialDate(a).getUTCFullYear();
        case 'MONTH': return a == null ? null : serialDate(a).getUTCMonth() + 1;
        case 'DAY': return a == null ? null : serialDate(a).getUTCDate();
        case 'EDATE': {
          const date = serialDate(a), target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + number(b), 1));
          const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
          target.setUTCDate(Math.min(date.getUTCDate(), last)); return (target.getTime() - EPOCH) / DAY;
        }
        case 'INDEX': {
          if (!Array.isArray(a)) throw new Error('INDEX 범위 오류');
          const result = a[number(b) - 1]?.[number(c ?? 1) - 1];
          if (result === undefined) throw new Error('요율표 범위를 벗어났습니다.'); return result;
        }
        case 'MATCH': {
          const values = b.flat(), exact = c === 0;
          let index = exact ? values.findIndex(v => v === a) : -1;
          if (!exact) for (let i = 0; i < values.length; i++) if (values[i] != null && values[i] <= a) index = i;
          if (index < 0) throw new Error('요율표에서 값을 찾을 수 없습니다.'); return index + 1;
        }
        case 'HLOOKUP': case 'VLOOKUP': {
          const rows = node.name === 'VLOOKUP' ? b : b[0].map((_, i) => b.map(row => row[i]));
          const exact = d === false || d === 0;
          let chosen;
          for (const row of rows) {
            if (exact ? row[0] === a : row[0] != null && row[0] <= a) { chosen = row; if (exact) break; }
          }
          if (!chosen || chosen[number(c) - 1] === undefined) throw new Error('요율표에서 값을 찾을 수 없습니다.');
          return chosen[number(c) - 1];
        }
        default: throw new Error('지원하지 않는 함수: ' + node.name);
      }
    }
  }
  function solveFee(book, overrides) {
    const input = {...overrides['설계용역비']};
    const budget = number(input.G8);
    const supervision = number(input.D21 ?? 0);
    if (budget <= 0 || !Number.isSafeInteger(budget)) throw new Error('예산액을 1원 이상의 정수로 입력하세요.');
    if (supervision < 0 || supervision >= budget) throw new Error('감리비는 0원 이상, 예산액 미만이어야 합니다.');
    // The original VBA increases F19 by 0.0001 until D19 exceeds D49.
    // Integer steps prevent accumulated binary rounding and guarantee termination.
    for (let steps = 0; steps < 10000; steps++) {
      const current = {...overrides, '설계용역비': {...input, D21: supervision, F19: steps / 10000}};
      const engine = new Engine(book, current);
      if (engine.get('설계용역비', 'D22') <= 0) break;
      const total = number(engine.get('설계용역비', 'D49'));
      const allocated = number(engine.get('설계용역비', 'D19'));
      if (total < allocated && total > 0) return {total, allocated, steps, engine, overrides: current};
    }
    throw new Error('예산 안에서 설계용역비를 산출할 수 없습니다. 예산·물량·감리비를 확인하세요.');
  }
  return {Engine, solveFee, format, koreanNumber, fromDateInput, toDateInput, colName, bounds, number};
});
