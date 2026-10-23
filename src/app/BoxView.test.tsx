import { renderToStaticMarkup } from 'react-dom/server';
import { BoxView } from './BoxView';

describe('BoxView', () => {
  it('shows any box as labelled fields, lists and nested blocks, with descriptions as hints', () => {
    const html = renderToStaticMarkup(<BoxView value={{ suspected_cause: 'Pool **exhaustion**', confidence: 0.8, files: ['a.py', 'b.py'], impact: { orders: 12 } }} descriptions={{ confidence: 'How sure, from 0 to 1' }} />);
    expect(html).toContain('<dt>Suspected cause</dt>');
    expect(html).toContain('<strong>exhaustion</strong>');
    expect(html).toContain('<dt title="How sure, from 0 to 1">Confidence</dt>');
    expect(html).toContain('<li><div class="md compact"><p>a.py</p></div></li>');
    expect(html).toContain('box-dl nested');
    expect(html).not.toContain('<pre');
  });

  it('falls back to JSON for anything that is not an object', () => {
    expect(renderToStaticMarkup(<BoxView value={[1, 2]} />)).toContain('<pre class="json">');
  });
});
