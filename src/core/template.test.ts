import { render, renderCommand, renderDeep } from './template';

describe('templates', () => {
  const ctx = { box: { ticket: 'PROJ-1', n: 3 }, params: { service: 'orders-api' } };
  it('fills paths and keeps types for whole-value tags', () => {
    expect(render('Fix {{box.ticket}} on {{params.service}}', ctx)).toBe('Fix PROJ-1 on orders-api');
    expect(render('{{box.n}}', ctx)).toBe(3);
    expect(render('{{int 4 4}}', ctx)).toBe(4);
    expect(render('{{pick a|b}}', ctx, () => 0.99)).toBe('b');
    expect(renderDeep({ a: ['{{box.ticket}}'], b: '{{num 1 1}}' }, ctx)).toEqual({ a: ['PROJ-1'], b: 1 });
  });
  it('shell-quotes values in commands', () => {
    expect(renderCommand('check {{box.ticket}}', { box: { ticket: "x'; rm -rf /" } })).toBe(`check 'x'\\''; rm -rf /'`);
  });
});
