import { render, screen, within } from '@testing-library/react';
import { Markdown } from './Markdown';

describe('Markdown written by agents', () => {
  it('shows emphasis, lists and tables as a person would read them', () => {
    render(<Markdown text={'**Delivery**\n\n- Jira ticket\n- PR review\n\n| a | b |\n|---|---|\n| 1 | 2 |'} />);
    expect(screen.getByText('Delivery').tagName).toBe('STRONG');
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Jira ticket', 'PR review']);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['a', 'b']);
    expect(within(table).getAllByRole('cell').map((c) => c.textContent)).toEqual(['1', '2']);
  });

  it('opens a link outside the app, without handing it the app', () => {
    render(<Markdown text="[the PR](https://github.com/acme-corp/x/pull/1)" />);
    const link = screen.getByRole('link', { name: 'the PR' });
    expect(link).toHaveAttribute('href', 'https://github.com/acme-corp/x/pull/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('never turns text into HTML that runs', () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)"> and <script>alert(1)</script>'} />);
    expect(container.querySelector('img, script')).toBeNull();
  });
});
