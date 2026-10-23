import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from './Markdown';

describe('Markdown', () => {
  it('renders lists, emphasis and tables written by agents', () => {
    const html = renderToStaticMarkup(<Markdown text={'**Delivery**\n\n- Jira ticket\n- PR review\n\n| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(html).toContain('<strong>Delivery</strong>');
    expect(html).toContain('<li>Jira ticket</li>');
    expect(html).toContain('<td>1</td>');
  });

  it('opens links outside the app', () => {
    expect(renderToStaticMarkup(<Markdown text="[PR](https://github.com/acme-corp/x/pull/1)" />)).toContain('target="_blank"');
  });

  it('never injects raw HTML', () => {
    expect(renderToStaticMarkup(<Markdown text={'<img src=x onerror="alert(1)">'} />)).not.toContain('<img');
  });
});
