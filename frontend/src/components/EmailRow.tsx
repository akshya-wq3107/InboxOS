import React from 'react';
import { ShieldAlert, MailOpen, Mail } from 'lucide-react';

export interface EmailData {
  id: string;
  sender: string;
  sender_name?: string;
  recipient?: string;
  subject: string;
  body?: string;
  body_text?: string;
  status?: string;
  is_read?: boolean;
  category?: string;
  createdAt?: string;
  received_at?: string;
  received?: string;
  similarity?: number;
  analysis?: {
    category: string;
    priority_score: number;
    urgency_score: number;
    actionability_score: number;
    summary: string;
    suggested_reply?: string;
    deadlines?: string[];
  };
}

interface EmailRowProps {
  email: EmailData;
  onClick?: (id: string) => void;
}

export const EmailRow = React.memo(function EmailRow({
  email,
  onClick,
}: EmailRowProps) {
  const isUnread =
    email.is_read === false ||
    email.status === 'UNREAD' ||
    (email.status === undefined &&
      email.is_read === undefined &&
      email.received !== undefined &&
      email.status !== 'READ');

  const senderName = email.sender_name || email.sender.split('@')[0];
  const senderEmail = email.sender;
  const subject = email.subject || '(No Subject)';

  const category = (
    email.analysis?.category ||
    email.category ||
    'personal'
  ).toLowerCase();
  const priorityScore = email.analysis?.priority_score || 50;

  const summary =
    email.analysis?.summary ||
    email.body_text ||
    email.body ||
    'No summary generated.';

  const rawDate = email.received_at || email.createdAt || email.received || 'Recently';
  const displayDate = React.useMemo(() => {
    if (!rawDate) return '';
    if (
      rawDate.includes('ago') ||
      rawDate.includes('today') ||
      rawDate.includes('PM') ||
      rawDate.includes('AM')
    )
      return rawDate;
    try {
      const date = new Date(rawDate);
      return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    } catch {
      return rawDate;
    }
  }, [rawDate]);

  // Neubrutalism: solid fill + black border, 0 radius
  const getCategoryStyle = (cat: string): React.CSSProperties => {
    switch (cat) {
      case 'urgent':   return { backgroundColor: '#E85C4A', color: '#fff', border: '1px solid #111' };
      case 'job':      return { backgroundColor: '#A855F7', color: '#fff', border: '1px solid #111' };
      case 'finance':  return { backgroundColor: '#4CAF6D', color: '#fff', border: '1px solid #111' };
      case 'meeting':  return { backgroundColor: '#6EC6E8', color: '#111', border: '1px solid #111' };
      case 'otp':      return { backgroundColor: '#F4C542', color: '#111', border: '1px solid #111' };
      case 'newsletter': return { backgroundColor: '#999', color: '#fff', border: '1px solid #111' };
      case 'support':  return { backgroundColor: '#6EC6E8', color: '#111', border: '1px solid #111' };
      case 'academic': return { backgroundColor: '#3B4CCA', color: '#fff', border: '1px solid #111' };
      case 'work':     return { backgroundColor: '#3B4CCA', color: '#fff', border: '1px solid #111' };
      default:         return { backgroundColor: '#F4C542', color: '#111', border: '1px solid #111' };
    }
  };

  const getPriorityStyle = (score: number): React.CSSProperties => {
    if (score > 85) return { backgroundColor: '#E85C4A', color: '#fff', border: '1px solid #111' };
    if (score > 65) return { backgroundColor: '#F4C542', color: '#111', border: '1px solid #111' };
    return { backgroundColor: '#eee', color: '#555', border: '1px solid #aaa' };
  };

  return (
    <div
      onClick={() => onClick?.(email.id)}
      className="p-4 cursor-pointer flex gap-4 transition-all duration-150"
      style={{
        backgroundColor: isUnread ? '#FFFDF5' : 'var(--color-surface)',
        border: isUnread
          ? '1px solid var(--color-ink)'
          : '1px solid var(--color-ink)',
        boxShadow: isUnread
          ? 'var(--shadow-offset)'
          : 'var(--shadow-offset-sm)',
        marginBottom: '6px',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'var(--shadow-offset-hover)';
        (e.currentTarget as HTMLElement).style.transform = 'translate(1px,1px)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = isUnread ? 'var(--shadow-offset)' : 'var(--shadow-offset-sm)';
        el.style.transform = '';
      }}
    >
      {/* Unread indicator strip */}
      <div className="flex flex-col justify-center items-center shrink-0 w-3">
        {isUnread ? (
          <span
            className="h-3 w-3"
            style={{ backgroundColor: 'var(--color-accent-cta)', border: '1px solid var(--color-ink)' }}
          />
        ) : (
          <span
            className="h-2.5 w-2.5"
            style={{ backgroundColor: '#ddd', border: '1px solid #bbb' }}
          />
        )}
      </div>

      {/* ── Main Row Metadata ─────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Row Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-1.5 md:gap-4 mb-2">
          <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-3 min-w-0 flex-1">
            <div className="flex items-center justify-between md:justify-start gap-2 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="text-xs truncate"
                  style={{
                    fontWeight: isUnread ? 800 : 600,
                    fontFamily: 'var(--font-body)',
                    color: 'var(--color-ink)',
                  }}
                >
                  {senderName}
                </span>
                <span
                  className="text-[10px] truncate hidden sm:inline"
                  style={{ color: '#666', fontFamily: 'var(--font-mono)' }}
                >
                  &lt;{senderEmail}&gt;
                </span>
              </div>

              {/* Mobile-only Date/Score */}
              <div className="flex items-center gap-2 md:hidden shrink-0">
                <span
                  className="text-[10px]"
                  style={{ color: '#777', fontFamily: 'var(--font-mono)' }}
                >
                  {displayDate}
                </span>
                <span
                  className="text-[9px] px-1.5 py-0.5 font-bold"
                  style={getPriorityStyle(priorityScore)}
                >
                  {priorityScore}
                </span>
              </div>
            </div>

            <span className="hidden md:inline" style={{ color: '#aaa', fontSize: 10 }}>•</span>

            {/* Subject */}
            <h4
              className="text-xs truncate"
              style={{
                fontWeight: isUnread ? 700 : 500,
                color: 'var(--color-ink)',
                fontFamily: 'var(--font-body)',
              }}
            >
              {subject}
            </h4>
          </div>

          {/* Desktop-only Date & Score */}
          <div className="hidden md:flex items-center gap-2.5 shrink-0">
            <span
              className="text-[10px]"
              style={{ color: '#777', fontFamily: 'var(--font-mono)' }}
            >
              {displayDate}
            </span>
            {email.similarity !== undefined && (
              <span
                className="text-[9px] px-1.5 py-0.5 font-bold"
                style={{ backgroundColor: 'var(--color-success)', color: '#fff', border: '1px solid #111' }}
              >
                {(email.similarity * 100).toFixed(0)}% Match
              </span>
            )}
            <span
              className="text-[9px] px-1.5 py-0.5 font-bold"
              style={getPriorityStyle(priorityScore)}
            >
              Score: {priorityScore}
            </span>
          </div>
        </div>

        {/* Summary preview */}
        <p
          className="text-[11px] leading-normal line-clamp-2 pr-4 mb-3"
          style={{ color: '#555', fontFamily: 'var(--font-body)' }}
        >
          {summary}
        </p>

        {/* Row Footer: badges */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-bold tracking-wider uppercase px-2 py-0.5"
              style={getCategoryStyle(category)}
            >
              {category}
            </span>
            {priorityScore > 85 && (
              <span
                className="text-[9px] font-bold px-2 py-0.5 flex items-center gap-1"
                style={{ backgroundColor: '#E85C4A', color: '#fff', border: '1px solid #111' }}
              >
                <ShieldAlert size={9} />
                <span>Urgent</span>
              </span>
            )}
          </div>

          <div style={{ color: '#999' }}>
            {isUnread ? <Mail size={12} /> : <MailOpen size={12} />}
          </div>
        </div>
      </div>
    </div>
  );
});
