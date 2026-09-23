import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * HubSpot pinned notes for tickets, deals, and Home Offices (Aaron, Sep
 * 2026 — the Home Office pinned note is an Evan Kuo initiative). Snapshots
 * carry only the note id; the note is fetched live from
 * GET /api/pinned-notes on first open and cached for the session.
 * Segments are plain strings and {label, href} links built server-side
 * (server/services/pinnedNotes.js) — no HubSpot HTML is ever injected.
 */

const noteCache = new Map();

function fetchNote(id) {
  if (!noteCache.has(id)) {
    noteCache.set(id, fetch(`/api/pinned-notes?ids=${encodeURIComponent(id)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
        return body.notes?.[id] || null;
      })
      .catch((err) => {
        noteCache.delete(id);
        throw err;
      }));
  }
  return noteCache.get(id);
}

export function PinnedNoteBody({ segments, modifiedAt, className = '' }) {
  if (!segments?.length) return null;
  return (
    <div className={className}>
      {modifiedAt && <p className="text-[11px] text-neutral-400 mb-1">Updated {modifiedAt.slice(0, 10)}</p>}
      <p className="text-xs text-neutral-700 whitespace-pre-wrap break-words">
        {segments.map((s, i) => (typeof s === 'string'
          ? <span key={i}>{s}</span>
          : <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="text-cool-glacier hover:underline">{s.label}</a>))}
      </p>
    </div>
  );
}

function useNote(noteId) {
  const [state, setState] = useState({ note: undefined, error: '' });
  useEffect(() => {
    if (!noteId) return undefined;
    let live = true;
    setState({ note: undefined, error: '' });
    fetchNote(String(noteId)).then(
      (note) => live && setState({ note, error: '' }),
      (err) => live && setState({ note: null, error: err.message })
    );
    return () => { live = false; };
  }, [noteId]);
  return state;
}

/** Always-visible pinned note block — used for the Home Office's own note at the top of an account drawer. */
export function PinnedNoteInline({ noteId, heading = 'Pinned note' }) {
  const { note, error } = useNote(noteId);
  if (!noteId || note === null) return null;
  return (
    <div className="mb-6 border border-accent-200 bg-accent-50/40 rounded-xl p-4">
      <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1">{heading}</p>
      {note === undefined && !error && <p className="text-xs text-neutral-500">Loading…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {note && <PinnedNoteBody segments={note.segments} modifiedAt={note.modifiedAt} className="max-h-72 overflow-y-auto" />}
    </div>
  );
}

const PANEL_WIDTH = 440;

function NotePanel({ noteId, title, anchor, onClose }) {
  const state = useNote(noteId);
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8));
    const below = r.bottom + 6;
    const top = below + 380 > window.innerHeight ? Math.max(8, r.top - 386) : below;
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    const onDown = (e) => {
      if (!panelRef.current?.contains(e.target) && !anchor.contains(e.target)) onClose();
    };
    const onScroll = (e) => {
      if (!panelRef.current?.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchor, onClose]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Pinned note${title ? `: ${title}` : ''}`}
      onClick={(e) => e.stopPropagation()}
      className="fixed z-50 bg-white border border-neutral-200 rounded-xl shadow-xl p-4"
      style={{ left: pos.left, top: pos.top, width: PANEL_WIDTH, maxWidth: 'calc(100vw - 16px)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">
          Pinned note{title ? <span className="normal-case font-normal text-neutral-400"> · {title}</span> : null}
        </p>
        <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-600 text-sm leading-none" aria-label="Close">✕</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {state.note === undefined && !state.error && <p className="text-xs text-neutral-500">Loading…</p>}
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        {state.note === null && !state.error && <p className="text-xs text-neutral-500 italic">The pinned item isn't a note (it may be a pinned email or call) — open the record in HubSpot.</p>}
        {state.note && <PinnedNoteBody segments={state.note.segments} modifiedAt={state.note.modifiedAt} />}
      </div>
    </div>,
    document.body
  );
}

/** Small "NOTE" pill next to a ticket/deal/account link; renders nothing without a pinned note. Stops propagation so it's safe inside clickable rows. */
export default function PinnedNoteButton({ noteId, title, className = '' }) {
  const [anchor, setAnchor] = useState(null);
  if (!noteId) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setAnchor((a) => (a ? null : e.currentTarget)); }}
        title="Show HubSpot pinned note"
        className={`inline-flex items-center align-middle text-[10px] font-semibold tracking-wide px-1.5 py-0.5 rounded border border-accent-300 text-accent-700 bg-accent-50 hover:bg-accent-100 ml-1.5 shrink-0 ${className}`}
      >
        NOTE
      </button>
      {anchor && <NotePanel noteId={String(noteId)} title={title} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}
