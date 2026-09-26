import { useEffect, useRef, useState } from 'react';
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

export function PinnedNoteBody({ segments, modifiedAt, className = '', textClassName = 'text-xs' }) {
  if (!segments?.length) return null;
  return (
    <div className={className}>
      {modifiedAt && <p className="text-[11px] text-neutral-400 mb-2">Updated {modifiedAt.slice(0, 10)}</p>}
      <p className={`${textClassName} text-neutral-700 whitespace-pre-wrap break-words`}>
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

/**
 * A centered modal, not an anchored popover (Sep 2026, Aaron: "bigger and
 * more persistent -- there is some great content in here") — the old
 * anchored-popover version closed on any page scroll (since it never
 * re-tracked the anchor's moving position) and capped content at a cramped
 * 440x320 box, both of which fought against actually reading a long note.
 * A backdrop-centered modal only closes on an explicit action (✕, Escape,
 * or backdrop click), stays put regardless of what's scrolling behind it,
 * and gets much more room for the note's own content.
 */
function NotePanel({ noteId, title, onClose }) {
  const state = useNote(noteId);
  const panelRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-label={`Pinned note${title ? `: ${title}` : ''}`}
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-neutral-200 rounded-xl shadow-2xl p-6 w-full"
        style={{ maxWidth: 720, maxHeight: '85vh' }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-sm font-semibold text-neutral-500 uppercase tracking-wide">
            Pinned note{title ? <span className="normal-case font-normal text-neutral-400"> · {title}</span> : null}
          </p>
          <button type="button" onClick={onClose} className="text-neutral-400 hover:text-neutral-600 text-lg leading-none" aria-label="Close">✕</button>
        </div>
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 64px)' }}>
          {state.note === undefined && !state.error && <p className="text-sm text-neutral-500">Loading…</p>}
          {state.error && <p className="text-sm text-red-600">{state.error}</p>}
          {state.note === null && !state.error && <p className="text-sm text-neutral-500 italic">The pinned item isn't a note (it may be a pinned email or call) — open the record in HubSpot.</p>}
          {state.note && <PinnedNoteBody segments={state.note.segments} modifiedAt={state.note.modifiedAt} textClassName="text-base leading-relaxed" />}
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Small "NOTE" pill next to a ticket/deal/account link; renders nothing without a pinned note. Stops propagation so it's safe inside clickable rows. */
export default function PinnedNoteButton({ noteId, title, className = '' }) {
  const [open, setOpen] = useState(false);
  if (!noteId) return null;
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title="Show HubSpot pinned note"
        className={`inline-flex items-center justify-center h-4 align-middle text-[9px] font-semibold tracking-wide px-[5px] rounded border border-accent-300 text-accent-700 bg-accent-50 hover:bg-accent-100 ml-1.5 shrink-0 ${className}`}
      >
        NOTE
      </button>
      {open && <NotePanel noteId={String(noteId)} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}
