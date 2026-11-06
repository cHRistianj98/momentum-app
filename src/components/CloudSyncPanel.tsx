import { useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, Cloud, CloudAlert, CloudDownload, CloudOff, CloudUpload, Copy, Eye, EyeOff,
  History, KeyRound, Link2, Power, RefreshCw, RotateCcw, Share2, Smartphone, Trash2,
} from 'lucide-react';
import type { AppData } from '../types';
import type { CloudSyncApi } from '../lib/useCloudSync';
import {
  formatSize, formatRecoveryCode, normalizeRecoveryCode,
  type CloudHistoryEntry, type CloudHistoryReason, type CloudLinkPreview, type CloudRemoteSummary, type CloudSyncEngine, type CloudSyncState,
} from '../lib/cloudSync';

export const CLOUD_SYNC_PANEL_ID = 'cloud-sync-panel';

function plural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  const units = count % 10;
  if (count === 1) return one;
  return units >= 2 && units <= 4 && (tens < 12 || tens > 14) ? few : many;
}

const tasksLabel = (count: number) => `${count} ${plural(count, 'zadanie', 'zadania', 'zadań')}`;
const routinesLabel = (count: number) => `${count} ${plural(count, 'rutyna', 'rutyny', 'rutyn')}`;

function relativeTime(iso: string | null, now: number): string {
  if (!iso) return 'jeszcze nie';
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return 'przed chwilą';
  if (minutes < 60) return `${minutes} min temu`;
  const date = new Date(time);
  const clock = date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  if (new Date(now).toDateString() === date.toDateString()) return `dziś, ${clock}`;
  return `${date.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}, ${clock}`;
}

interface StatusView { tone: 'ok' | 'busy' | 'warn' | 'error' | 'muted'; icon: ReactNode; title: string; detail: string }

function describeStatus(state: CloudSyncState, now: number): StatusView {
  switch (state.phase) {
    case 'syncing':
      return { tone: 'busy', icon: <RefreshCw size={18} className="cloud-spin"/>, title: 'Synchronizuję…', detail: 'Wysyłam i sprawdzam zmiany.' };
    case 'offline':
      return { tone: 'muted', icon: <CloudOff size={18}/>, title: 'Brak połączenia',
        detail: state.pendingLocal ? 'Zmiany są bezpieczne na tym urządzeniu — wyślę je, gdy wróci internet.' : 'Dane są bezpieczne na tym urządzeniu.' };
    case 'conflict':
      return { tone: 'warn', icon: <CloudAlert size={18}/>, title: 'Zmiany na dwóch urządzeniach', detail: 'Wybierz poniżej, którą wersję zachować.' };
    case 'update-ready':
      return { tone: 'warn', icon: <CloudDownload size={18}/>, title: 'Są nowsze dane',
        detail: state.pendingLocal ? 'Wczytanie połączy je z Twoimi zmianami — nic nie zginie.' : 'Czekają na wczytanie — nic nie zostało nadpisane.' };
    case 'error':
      return { tone: 'error', icon: <AlertTriangle size={18}/>,
        title: state.error === 'too-large' ? 'Za dużo danych do synchronizacji' : state.error === 'not-found' ? 'Brak danych na serwerze' : 'Synchronizacja wstrzymana',
        detail: state.message ?? 'Spróbuję ponownie za chwilę.' };
    default:
      return state.pendingLocal
        ? { tone: 'busy', icon: <CloudUpload size={18}/>, title: 'Zmiany czekają na wysłanie', detail: `Ostatnia synchronizacja: ${relativeTime(state.lastSyncAt, now)}` }
        : { tone: 'ok', icon: <CheckCircle2 size={18}/>, title: 'Zsynchronizowano',
          detail: `${relativeTime(state.lastSyncAt, now)}${state.lastSize ? ` · ${formatSize(state.lastSize)}` : ''}` };
  }
}

/** Ustawienia → „Synchronizacja w chmurze”. */
export function CloudSyncPanel({ api, data }: { api: CloudSyncApi; data: AppData }) {
  const { state, engine } = api;
  const [view, setView] = useState<'main' | 'link'>('main');
  const [codeInput, setCodeInput] = useState('');
  const [preview, setPreview] = useState<CloudLinkPreview | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [server, setServer] = useState<{ ok: boolean; message: string | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { setNow(Date.now()); }, [state.lastSyncAt]);
  // Przed włączeniem sprawdzamy, czy backend (Functions + D1) jest gotowy — pomaga przy konfiguracji.
  useEffect(() => {
    if (state.enabled) return undefined;
    let cancelled = false;
    setServer(null);
    void engine.checkServer().then(result => { if (!cancelled) setServer(result); });
    return () => { cancelled = true; };
  }, [engine, state.enabled]);

  const busy = working !== null || state.phase === 'syncing';

  async function run(name: string, action: () => Promise<void>, success?: string) {
    setWorking(name);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Coś poszło nie tak. Spróbuj ponownie.');
    } finally {
      setWorking(null);
    }
  }

  function closeLink() {
    setView('main');
    setCodeInput('');
    setPreview(null);
    setAccepted(false);
    setError(null);
  }

  async function copyCode(code: string) {
    setError(null);
    try {
      await navigator.clipboard.writeText(formatRecoveryCode(code));
      setNotice('Skopiowano kod. Zachowaj go np. w Hasłach lub Notatkach.');
    } catch {
      setRevealed(true);
      setNotice('Nie udało się skopiować — kod jest widoczny, przepisz go ręcznie.');
    }
  }

  async function shareCode(code: string) {
    const text = `Kod synchronizacji Momentum: ${formatRecoveryCode(code)}\nNa nowym urządzeniu: Ustawienia → Synchronizacja w chmurze → Mam kod.`;
    if (typeof navigator.share !== 'function') { await copyCode(code); return; }
    try { await navigator.share({ title: 'Kod synchronizacji Momentum', text }); }
    catch { /* anulowane udostępnianie */ }
  }

  const messages = <>
    {notice && <div className="backup-message backup-message--success" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {error && <div className="backup-message backup-message--error" role="alert"><AlertTriangle size={16}/>{error}</div>}
  </>;

  const heading = <div className="cloud-sync-head">
    <span className="cloud-sync-symbol"><Cloud size={19}/></span>
    <div>
      <strong id="cloud-sync-title">Synchronizacja w chmurze</strong>
      <small>Automatyczna kopia w chmurze i ten sam plan na kilku urządzeniach — bez zakładania konta.</small>
    </div>
  </div>;

  if (!state.enabled && view === 'link') {
    const normalized = normalizeRecoveryCode(codeInput);
    return <section className="cloud-sync" id={CLOUD_SYNC_PANEL_ID} aria-labelledby="cloud-sync-title">
      {heading}
      <label className="cloud-sync-field">
        <span>Kod z innego urządzenia</span>
        <input value={codeInput} disabled={!!preview || busy} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} maxLength={40}
          onChange={event => { setError(null); setCodeInput(formatRecoveryCode(normalizeRecoveryCode(event.target.value))); }}/>
        <small>Znajdziesz go na pierwszym urządzeniu: Ustawienia → Synchronizacja w chmurze → Kod odzyskiwania.</small>
      </label>
      {!preview ? <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={normalized.length < 24 || busy}
          onClick={() => { void run('check', async () => { setPreview(await engine.previewLink(codeInput)); }); }}>
          <Link2 size={16}/>{working === 'check' ? 'Sprawdzam…' : 'Sprawdź kod'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={closeLink}>Anuluj</button>
      </div> : <div className="backup-import-preview cloud-sync-preview">
        <div className="backup-import-title"><Cloud size={22}/><div><strong>Dane w chmurze</strong><small>Ostatni zapis: {relativeTime(preview.remote.updatedAt, now)}</small></div></div>
        <div className="backup-counts">
          <span><strong>{preview.remote.preview.tasks}</strong>{plural(preview.remote.preview.tasks, 'zadanie', 'zadania', 'zadań')}</span>
          <span><strong>{preview.remote.preview.projects}</strong>{plural(preview.remote.preview.projects, 'projekt', 'projekty', 'projektów')}</span>
          <span><strong>{preview.remote.preview.routines}</strong>{plural(preview.remote.preview.routines, 'rutyna', 'rutyny', 'rutyn')}</span>
          <span><strong>{preview.remote.preview.focusSessions}</strong>{plural(preview.remote.preview.focusSessions, 'sesja Focus', 'sesje Focus', 'sesji Focus')}</span>
        </div>
        <p className="backup-import-warning"><AlertTriangle size={17}/><span>Połączenie <strong>zastąpi wszystkie dane Momentum na tym urządzeniu</strong> (teraz: {tasksLabel(data.tasks.length)}) danymi z chmury.</span></p>
        <label className="backup-confirm-label"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/><span>Rozumiem, że obecne dane na tym urządzeniu zostaną zastąpione.</span></label>
        <div className="cloud-sync-actions">
          <button type="button" className="btn btn--danger" disabled={!accepted || busy}
            onClick={() => { void run('link', () => engine.confirmLink(preview.code)); }}>
            <CloudDownload size={16}/>{working === 'link' ? 'Wczytuję…' : 'Połącz i wczytaj dane'}
          </button>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={closeLink}>Anuluj</button>
        </div>
      </div>}
      {messages}
    </section>;
  }

  if (!state.enabled) {
    return <section className="cloud-sync" id={CLOUD_SYNC_PANEL_ID} aria-labelledby="cloud-sync-title">
      {heading}
      <p className={`cloud-sync-server ${server ? (server.ok ? 'is-ok' : 'is-down') : ''}`} role="status">
        <span aria-hidden="true"/>{server ? (server.ok ? 'Serwer synchronizacji jest gotowy.' : server.message) : 'Sprawdzam serwer…'}
      </p>
      {state.code && <p className="cloud-sync-note">Synchronizacja jest wyłączona na tym urządzeniu. Zapamiętany kod kończy się na <b>{state.code.slice(-4)}</b>.</p>}
      <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={busy || server?.ok === false}
          onClick={() => { void run('enable', () => engine.enable(), state.code ? 'Synchronizacja włączona ponownie.' : 'Gotowe — synchronizacja działa. Zapisz kod odzyskiwania: tylko nim połączysz nowy telefon.'); }}>
          <CloudUpload size={16}/>{working === 'enable' ? 'Włączam…' : state.code ? 'Włącz ponownie' : 'Włącz synchronizację'}
        </button>
        <button type="button" className="btn btn--secondary" disabled={busy || server?.ok === false} onClick={() => { setNotice(null); setView('link'); }}>
          <Link2 size={16}/> Mam kod z innego urządzenia
        </button>
      </div>
      <p className="cloud-sync-note"><KeyRound size={14}/><span>Po włączeniu dostaniesz 24-znakowy kod odzyskiwania. Działa jak hasło: zapisz go, bo tylko nim połączysz nowy telefon z danymi w chmurze.</span></p>
      {state.code && <button type="button" className="cloud-sync-text-btn" disabled={busy}
        onClick={() => { if (window.confirm('Zapomnieć kod na tym urządzeniu? Dane w chmurze zostaną, ale bez kodu nie da się ich odzyskać.')) engine.forget(); }}>
        Zapomnij kod na tym urządzeniu
      </button>}
      {messages}
    </section>;
  }

  const status = describeStatus(state, now);
  const code = state.code ?? '';
  return <section className="cloud-sync" id={CLOUD_SYNC_PANEL_ID} aria-labelledby="cloud-sync-title">
    {heading}
    <div className={`cloud-sync-status is-${status.tone}`} role="status">
      <span className="cloud-sync-status-icon">{status.icon}</span>
      <div><strong>{status.title}</strong><small>{status.detail}</small></div>
      <button type="button" className="cloud-sync-icon-btn" disabled={busy} aria-label="Synchronizuj teraz" title="Synchronizuj teraz"
        onClick={() => { void run('sync', () => engine.syncNow()); }}>
        <RefreshCw size={17}/>
      </button>
    </div>
    {messages}

    {state.phase === 'conflict' && state.remote && <div className="cloud-sync-choice">
      <p><strong>Nie udało się automatycznie połączyć zmian</strong> (brak wspólnej wersji, np. po aktualizacji aplikacji). Wybierz wersję do zachowania. Jeśli zachowasz tę z urządzenia, wersja z chmury trafi do historii.</p>
      <div className="cloud-sync-compare">
        <div><span><Smartphone size={14}/> To urządzenie</span><b>{tasksLabel(data.tasks.length)}</b><small>{routinesLabel(data.routines.length)} · teraz</small></div>
        <div><span><Cloud size={14}/> Chmura</span><b>{tasksLabel(state.remote.preview.tasks)}</b><small>{routinesLabel(state.remote.preview.routines)} · {relativeTime(state.remote.updatedAt, now)}</small></div>
      </div>
      <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => { void run('keep', () => engine.keepLocal(), 'Zachowano dane z tego urządzenia. Poprzednia wersja z chmury jest w historii.'); }}>
          <CloudUpload size={16}/> Zachowaj z tego urządzenia
        </button>
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { void run('take', () => engine.takeRemote()); }}>
          <CloudDownload size={16}/> Wczytaj z chmury
        </button>
      </div>
      <small className="cloud-sync-hint">Nie masz pewności? Najpierw pobierz kopię JSON w sekcji poniżej.</small>
    </div>}

    {state.phase === 'update-ready' && <div className="cloud-sync-choice is-info">
      <p><strong>Na innym urządzeniu zapisano nowsze dane.</strong> {state.pendingLocal
        ? 'Wczytanie połączy je ze zmianami z tego urządzenia i odświeży aplikację.'
        : 'Wczytanie odświeży aplikację.'}</p>
      <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => { void run('take', () => engine.loadUpdate()); }}>
          <CloudDownload size={16}/> {state.pendingLocal ? 'Wczytaj i połącz' : 'Wczytaj teraz'}
        </button>
      </div>
    </div>}

    {state.error === 'not-found' && <div className="cloud-sync-choice">
      <p>Możesz wysłać dane z tego urządzenia ponownie (ten sam kod) albo wyłączyć synchronizację.</p>
      <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => { void run('enable', () => engine.enable(), 'Dane wysłane ponownie.'); }}>
          <CloudUpload size={16}/> Wyślij dane ponownie
        </button>
      </div>
    </div>}

    <div className="cloud-sync-code">
      <div className="cloud-sync-code-label"><KeyRound size={15}/><span>Kod odzyskiwania</span></div>
      <code aria-label={revealed ? 'Kod odzyskiwania' : 'Kod odzyskiwania (ukryty)'}>
        {revealed ? formatRecoveryCode(code) : `••••-••••-••••-••••-••••-${code.slice(-4)}`}
      </code>
      <div className="cloud-sync-code-actions">
        <button type="button" onClick={() => setRevealed(value => !value)}>{revealed ? <EyeOff size={15}/> : <Eye size={15}/>}{revealed ? 'Ukryj' : 'Pokaż'}</button>
        <button type="button" onClick={() => { void copyCode(code); }}><Copy size={15}/>Kopiuj</button>
        <button type="button" onClick={() => { void shareCode(code); }}><Share2 size={15}/>Udostępnij</button>
      </div>
      <small>Na nowym urządzeniu wybierz „Mam kod z innego urządzenia”. Kto zna kod, ma dostęp do Twoich danych.</small>
    </div>

    <CloudHistorySection engine={engine} busy={busy} now={now}/>

    <div className="cloud-sync-footer">
      <button type="button" className="cloud-sync-text-btn" disabled={working !== null} onClick={() => { engine.disable(); setNotice('Synchronizacja wyłączona. Dane zostały na tym urządzeniu i w chmurze.'); }}>
        <Power size={15}/> Wyłącz na tym urządzeniu
      </button>
      <button type="button" className="cloud-sync-text-btn is-danger" disabled={busy}
        onClick={() => {
          if (!window.confirm('Usunąć dane Momentum z serwera? Dane na tym urządzeniu zostaną, ale inne połączone urządzenia przestaną się synchronizować.')) return;
          void run('delete', () => engine.deleteRemote(), 'Usunięto dane z serwera. Dane na tym urządzeniu zostały bez zmian.');
        }}>
        <Trash2 size={15}/> Usuń dane z serwera
      </button>
    </div>
  </section>;
}

const REASON_LABELS: Record<CloudHistoryReason, string> = {
  daily: 'Kopia dzienna',
  shrink: 'Przed usunięciem danych',
  manual: 'Przed zmianą wersji',
};

function savedAtLabel(iso: string, now: number): string {
  const date = new Date(iso);
  const clock = date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === today.toDateString()) return `Dziś, ${clock}`;
  if (date.toDateString() === yesterday.toDateString()) return `Wczoraj, ${clock}`;
  const day = date.toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
  return `${day.charAt(0).toLocaleUpperCase('pl-PL')}${day.slice(1)}, ${clock}`;
}

/** Historia wersji z serwera (30 dni): lista, podgląd i przywrócenie z potwierdzeniem. */
function CloudHistorySection({ engine, busy, now }: { engine: CloudSyncEngine; busy: boolean; now: number }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CloudHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ entry: CloudHistoryEntry; summary: CloudRemoteSummary } | null>(null);
  const [previewing, setPreviewing] = useState<number | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [restoring, setRestoring] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try { setEntries(await engine.listHistory()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać historii.'); }
    finally { setLoading(false); }
  }
  async function openPreview(entry: CloudHistoryEntry) {
    setPreviewing(entry.revision);
    setError(null);
    setAccepted(false);
    try { setPreview({ entry, summary: await engine.previewHistory(entry.revision) }); }
    catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : 'Nie udało się wczytać tej wersji.'); }
    finally { setPreviewing(null); }
  }
  async function restore() {
    if (!preview) return;
    setRestoring(true);
    setError(null);
    try { await engine.restoreHistory(preview.entry.revision); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się przywrócić wersji.'); setRestoring(false); }
  }

  const counts = preview?.summary.preview;
  return <div className="cloud-history">
    <div className="cloud-history-head">
      <span className="cloud-history-icon"><History size={16}/></span>
      <div><strong>Historia wersji</strong><small>Kopie z ostatnich 30 dni. Przywrócenie można cofnąć — obecna wersja też trafi do historii.</small></div>
    </div>
    {!open ? <button type="button" className="btn btn--secondary cloud-history-open" disabled={busy}
      onClick={() => { setOpen(true); void load(); }}><History size={16}/> Pokaż historię</button> : <>
      {loading && <p className="cloud-history-empty"><RefreshCw size={14} className="cloud-spin"/> Wczytuję historię…</p>}
      {!loading && entries?.length === 0 && <p className="cloud-history-empty">Na razie brak kopii. Pierwsza powstanie przy kolejnej zmianie danych, a potem raz dziennie — przy pierwszej zmianie danego dnia.</p>}
      {!loading && !!entries?.length && <ul className="cloud-history-list">
        {entries.map(entry => <li key={entry.revision} className={preview?.entry.revision === entry.revision ? 'is-selected' : ''}>
          <div><strong>{savedAtLabel(entry.savedAt, now)}</strong><small>{REASON_LABELS[entry.reason]}{entry.size ? ` · ${formatSize(entry.size)}` : ''}</small></div>
          <button type="button" disabled={busy || restoring || previewing !== null} onClick={() => { void openPreview(entry); }}>
            {previewing === entry.revision ? 'Wczytuję…' : 'Podgląd'}
          </button>
        </li>)}
      </ul>}
      {preview && counts && <div className="backup-import-preview cloud-history-preview">
        <div className="backup-import-title"><History size={22}/><div><strong>Wersja: {savedAtLabel(preview.entry.savedAt, now).toLocaleLowerCase('pl-PL')}</strong><small>{REASON_LABELS[preview.entry.reason]}</small></div></div>
        <div className="backup-counts">
          <span><strong>{counts.tasks}</strong>{plural(counts.tasks, 'zadanie', 'zadania', 'zadań')}</span>
          <span><strong>{counts.projects}</strong>{plural(counts.projects, 'projekt', 'projekty', 'projektów')}</span>
          <span><strong>{counts.routines}</strong>{plural(counts.routines, 'rutyna', 'rutyny', 'rutyn')}</span>
          <span><strong>{counts.focusSessions}</strong>{plural(counts.focusSessions, 'sesja Focus', 'sesje Focus', 'sesji Focus')}</span>
        </div>
        <p className="backup-import-warning"><AlertTriangle size={17}/><span>Przywrócenie <strong>zastąpi obecne dane na tym i pozostałych urządzeniach</strong>. Obecna wersja trafi do historii, więc w razie potrzeby wrócisz do niej.</span></p>
        <label className="backup-confirm-label"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/><span>Rozumiem — przywróć tę wersję.</span></label>
        <div className="cloud-sync-actions">
          <button type="button" className="btn btn--danger" disabled={!accepted || restoring || busy} onClick={() => { void restore(); }}>
            <RotateCcw size={16}/>{restoring ? 'Przywracam…' : 'Przywróć tę wersję'}
          </button>
          <button type="button" className="btn btn--secondary" disabled={restoring} onClick={() => { setPreview(null); setAccepted(false); }}>Anuluj</button>
        </div>
      </div>}
      {error && <div className="backup-message backup-message--error" role="alert"><AlertTriangle size={16}/>{error}</div>}
      {!loading && <button type="button" className="cloud-sync-text-btn cloud-history-refresh" disabled={busy || restoring} onClick={() => { setPreview(null); void load(); }}>
        <RefreshCw size={14}/> Odśwież listę
      </button>}
    </>}
  </div>;
}

/** Pasek na górze ekranu tylko wtedy, gdy potrzebna jest decyzja (konflikt) lub czekają nowsze dane. */
export function CloudSyncBanner({ api, onResolve }: { api: CloudSyncApi; onResolve: () => void }) {
  const { state, engine } = api;
  const [working, setWorking] = useState(false);
  if (!state.enabled || (state.phase !== 'conflict' && state.phase !== 'update-ready')) return null;
  const conflict = state.phase === 'conflict';
  return <div className={`cloud-banner${conflict ? ' is-conflict' : ''}`} role="status">
    <span className="cloud-banner-icon">{conflict ? <CloudAlert size={19}/> : <CloudDownload size={19}/>}</span>
    <div className="cloud-banner-text">
      <strong>{conflict ? 'Zmiany na dwóch urządzeniach' : 'Nowe dane z innego urządzenia'}</strong>
      <small>{conflict ? 'Wybierz, którą wersję zachować.' : state.pendingLocal ? 'Wczytaj — połączę je z Twoimi zmianami.' : 'Wczytaj, aby zobaczyć aktualny plan.'}</small>
    </div>
    <button type="button" className="cloud-banner-action" disabled={working}
      onClick={() => {
        if (conflict) { onResolve(); return; }
        setWorking(true);
        void engine.loadUpdate().finally(() => setWorking(false));
      }}>
      {conflict ? 'Wybierz' : working ? 'Wczytuję…' : 'Wczytaj'}
    </button>
  </div>;
}
