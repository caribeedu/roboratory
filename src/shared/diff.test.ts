import { diffLines } from './diff';

describe('diffLines', () => {
  it('marks added and removed lines', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nc')).toEqual([{ t: ' ', s: 'a' }, { t: '-', s: 'b' }, { t: '+', s: 'x' }, { t: ' ', s: 'c' }]);
    expect(diffLines('', 'new').filter((d) => d.t === '+')).toEqual([{ t: '+', s: 'new' }]);
  });
});
