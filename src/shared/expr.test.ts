import { describe as describeRule, describeParts, evaluate, parseExpr, ruleFields } from './expr';

describe('rule expressions', () => {
  const box = { type: 'bug', confidence: 0.72, severity: 'sev2', tags: ['a'], nested: { ok: true }, n: 3 };

  it.each([
    ["type == 'bug'", true],
    ["type == 'question'", false],
    ['type != "bug"', false],
    ['confidence >= 0.7', true],
    ['confidence < 0.5', false],
    ['n > 2 && n <= 3', true],
    ["type == 'x' || severity == 'sev2'", true],
    ['!(n == 3)', false],
    ['nested.ok == true', true],
    ["severity in ['sev1', 'sev2']", true],
    ["severity in ['sev3']", false],
    ['missing == null', true],
    ['nested.ok', true],
  ])('%s → %s', (src, expected) => {
    expect(evaluate(src, box)).toBe(expected);
  });

  it('rejects malformed expressions with a readable message', () => {
    expect(() => parseExpr('type ==')).toThrow(/expected a value/i);
    expect(() => parseExpr("type == 'x")).toThrow(/unterminated string/i);
    expect(() => parseExpr('a b')).toThrow(/unexpected/i);
  });

  it('never executes code', () => {
    expect(() => parseExpr('process.exit()')).toThrow();
  });
});

describe('describe rules for people', () => {
  it.each([
    ["verdict == 'pass'", 'the verdict is pass'],
    ["decision.choice == 'revise'", 'you choose to revise'],
    ["decision.choice == 'rollback' || decision.choice == 'monitor'", 'you choose to rollback or monitor'],
    ['confidence >= 0.7', 'the confidence is at least 0.7'],
    ["severity in ['sev1', 'sev2']", 'the severity is sev1 or sev2'],
    ["type != 'bug' && n < 3", 'the type is not bug and the n is less than 3'],
    ['!done', 'not (the done is set)'],
    ['error_rate <= 1', 'the error rate is at most 1'],
  ])('%s → %s', (src, text) => {
    expect(describeRule(src)).toBe(text);
  });
  it('falls back to the raw rule when it cannot be parsed', () => {
    expect(describeRule('a ==')).toBe('a ==');
  });
});

describe('rule parts', () => {
  it('keeps compared values apart from the sentence', () => {
    expect(describeParts("verdict == 'fail'")).toEqual([{ text: 'the ' }, { text: 'verdict', field: true }, { text: ' is ' }, { text: 'fail', value: true }]);
    expect(describeParts("decision.choice == 'a' || decision.choice == 'b'")).toEqual([{ text: 'you choose to ' }, { text: 'a', value: true }, { text: ' or ' }, { text: 'b', value: true }]);
  });
});

describe('rule fields', () => {
  it('lists the fields a rule reads and the values it compares them to', () => {
    expect(ruleFields("decision.choice == 'a' || decision.choice == 'b'")).toEqual([{ path: ['decision', 'choice'], values: ['a', 'b'], ops: ['=='] }]);
    expect(ruleFields("verdict == 'fail' && n > 2")).toEqual([{ path: ['verdict'], values: ['fail'], ops: ['=='] }, { path: ['n'], values: [2], ops: ['>'] }]);
    expect(ruleFields("severity in ['sev1', 'sev2']")).toEqual([{ path: ['severity'], values: ['sev1', 'sev2'], ops: ['in'] }]);
    expect(ruleFields("ci != 'green'")).toEqual([{ path: ['ci'], values: ['green'], ops: ['!='] }]);
    expect(ruleFields('!done')).toEqual([{ path: ['done'], values: [], ops: ['!'] }]);
    expect(ruleFields("!(verdict == 'pass')")).toEqual([{ path: ['verdict'], values: ['pass'], ops: ['!'] }]);
  });
});
