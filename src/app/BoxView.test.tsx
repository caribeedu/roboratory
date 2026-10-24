import { render, screen, within } from '@testing-library/react';
import { BoxView } from './BoxView';

describe('A box on screen', () => {
  const box = { suspected_cause: 'Pool **exhaustion**', confidence: 0.8, files: ['a.py', 'b.py'], impact: { orders: 12 } };

  it('shows each field of the box under a readable name', () => {
    render(<BoxView value={box} />);
    expect(screen.getByText('Suspected cause')).toBeInTheDocument();
    expect(screen.getByText('Confidence')).toBeInTheDocument();
    expect(screen.getByText('0.8')).toBeInTheDocument();
  });

  it('reads text fields as Markdown, lists as lists, and nested objects as their own block', () => {
    render(<BoxView value={box} />);
    expect(screen.getByText('exhaustion').tagName).toBe('STRONG');
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a.py', 'b.py']);
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows what a field means as a hint on its name', () => {
    render(<BoxView value={box} descriptions={{ confidence: 'How sure, from 0 to 1' }} />);
    expect(screen.getByText('Confidence')).toHaveAttribute('title', 'How sure, from 0 to 1');
    expect(screen.getByText('Suspected cause')).not.toHaveAttribute('title');
  });

  it('shows the box as JSON when asked, exactly as it is', () => {
    render(<BoxView value={{ ok: true }} raw />);
    expect(screen.getByText(/"ok": true/)).toBeInTheDocument();
  });

  it('falls back to JSON for anything that is not an object', () => {
    render(<BoxView value={[1, 2]} />);
    expect(screen.getByText(/\[\s*1,\s*2\s*\]/)).toBeInTheDocument();
  });
});
