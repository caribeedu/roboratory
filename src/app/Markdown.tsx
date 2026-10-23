// Text written by agents (manager answers, questions, transcripts) is Markdown.
// react-markdown builds React elements, never raw HTML, and links open in the browser.
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
};

/** `compact` keeps one-line contexts (transcripts) tight: no block margins. */
export function Markdown({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div className={`md${compact ? ' compact' : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{text}</ReactMarkdown>
    </div>
  );
}
