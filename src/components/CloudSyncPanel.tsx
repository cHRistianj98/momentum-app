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
import { locale, pick, plural, text, tr, type Localized } from '../lib/i18n';

export const CLOUD_SYNC_PANEL_ID = 'cloud-sync-panel';

const tasksWord = (count: number) => plural(count, ['zadanie', 'zadania', 'zadań'], ['task', 'tasks']);
const projectsWord = (count: number) => plural(count, ['projekt', 'projekty', 'projektów'], ['project', 'projects']);
const routinesWord = (count: number) => plural(count, ['rutyna', 'rutyny', 'rutyn'], ['routine', 'routines']);
const focusSessionsWord = (count: number) => plural(count, ['sesja Focus', 'sesje Focus', 'sesji Focus'], ['Focus session', 'Focus sessions']);

const tasksLabel = (count: number) => `${count} ${tasksWord(count)}`;
const routinesLabel = (count: number) => `${count} ${routinesWord(count)}`;

function relativeTime(iso: string | null, now: number): string {
  if (!iso) return tr('jeszcze nie', 'not yet');
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '—';
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return tr('przed chwilą', 'just now');
  if (minutes < 60) return tr(`${minutes} min temu`, `${minutes} min ago`);
  const date = new Date(time);
  const clock = date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  if (new Date(now).toDateString() === date.toDateString()) return tr(`dziś, ${clock}`, `today, ${clock}`);
  return `${date.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}, ${clock}`;
}

interface StatusView { tone: 'ok' | 'busy' | 'warn' | 'error' | 'muted'; icon: ReactNode; title: string; detail: string }

function describeStatus(state: CloudSyncState, now: number): StatusView {
  switch (state.phase) {
    case 'syncing':
      return { tone: 'busy', icon: <RefreshCw size={18} className="cloud-spin"/>, title: tr('Synchronizuję…', 'Syncing…'),
        detail: tr('Wysyłam i sprawdzam zmiany.', 'Uploading and checking for changes.') };
    case 'offline':
      return { tone: 'muted', icon: <CloudOff size={18}/>, title: tr('Brak połączenia', 'No connection'),
        detail: state.pendingLocal
          ? tr('Zmiany są bezpieczne na tym urządzeniu — wyślę je, gdy wróci internet.', 'Your changes are safe on this device — they’ll be uploaded when you’re back online.')
          : tr('Dane są bezpieczne na tym urządzeniu.', 'Your data is safe on this device.') };
    case 'conflict':
      return { tone: 'warn', icon: <CloudAlert size={18}/>, title: tr('Zmiany na dwóch urządzeniach', 'Changes on two devices'),
        detail: tr('Wybierz poniżej, którą wersję zachować.', 'Choose below which version to keep.') };
    case 'update-ready':
      return { tone: 'warn', icon: <CloudDownload size={18}/>, title: tr('Są nowsze dane', 'Newer data available'),
        detail: state.pendingLocal
          ? tr('Wczytanie połączy je z Twoimi zmianami — nic nie zginie.', 'Loading will merge it with your changes — nothing will be lost.')
          : tr('Czekają na wczytanie — nic nie zostało nadpisane.', 'Waiting to be loaded — nothing has been overwritten.') };
    case 'error':
      return { tone: 'error', icon: <AlertTriangle size={18}/>,
        title: state.error === 'too-large' ? tr('Za dużo danych do synchronizacji', 'Too much data to sync')
          : state.error === 'not-found' ? tr('Brak danych na serwerze', 'No data on the server') : tr('Synchronizacja wstrzymana', 'Sync paused'),
        detail: state.message ?? tr('Spróbuję ponownie za chwilę.', 'Will try again shortly.') };
    default:
      return state.pendingLocal
        ? { tone: 'busy', icon: <CloudUpload size={18}/>, title: tr('Zmiany czekają na wysłanie', 'Changes waiting to upload'),
          detail: tr(`Ostatnia synchronizacja: ${relativeTime(state.lastSyncAt, now)}`, `Last sync: ${relativeTime(state.lastSyncAt, now)}`) }
        : { tone: 'ok', icon: <CheckCircle2 size={18}/>, title: tr('Zsynchronizowano', 'Synced'),
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
      setError(cause instanceof Error ? cause.message : tr('Coś poszło nie tak. Spróbuj ponownie.', 'Something went wrong. Please try again.'));
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
      setNotice(tr('Skopiowano kod. Zachowaj go np. w Hasłach lub Notatkach.', 'Code copied. Keep it somewhere safe, e.g. in Passwords or Notes.'));
    } catch {
      setRevealed(true);
      setNotice(tr('Nie udało się skopiować — kod jest widoczny, przepisz go ręcznie.', 'Couldn’t copy — the code is now visible, so write it down manually.'));
    }
  }

  async function shareCode(code: string) {
    const message = tr(
      `Kod synchronizacji Momentum: ${formatRecoveryCode(code)}\nNa nowym urządzeniu: Ustawienia → Synchronizacja w chmurze → Mam kod.`,
      `Momentum sync code: ${formatRecoveryCode(code)}\nOn the new device: Settings → Cloud sync → I have a code.`,
    );
    if (typeof navigator.share !== 'function') { await copyCode(code); return; }
    try { await navigator.share({ title: tr('Kod synchronizacji Momentum', 'Momentum sync code'), text: message }); }
    catch { /* anulowane udostępnianie */ }
  }

  const messages = <>
    {notice && <div className="backup-message backup-message--success" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {error && <div className="backup-message backup-message--error" role="alert"><AlertTriangle size={16}/>{error}</div>}
  </>;

  const heading = <div className="cloud-sync-head">
    <span className="cloud-sync-symbol"><Cloud size={19}/></span>
    <div>
      <strong id="cloud-sync-title">{tr('Synchronizacja w chmurze', 'Cloud sync')}</strong>
      <small>{tr('Automatyczna kopia w chmurze i ten sam plan na kilku urządzeniach — bez zakładania konta.', 'Automatic cloud backup and the same plan on several devices — no account needed.')}</small>
    </div>
  </div>;

  if (!state.enabled && view === 'link') {
    const normalized = normalizeRecoveryCode(codeInput);
    return <section className="cloud-sync" id={CLOUD_SYNC_PANEL_ID} aria-labelledby="cloud-sync-title">
      {heading}
      <label className="cloud-sync-field">
        <span>{tr('Kod z innego urządzenia', 'Code from another device')}</span>
        <input value={codeInput} disabled={!!preview || busy} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
          autoComplete="off" autoCorrect="off" autoCapitalize="characters" spellCheck={false} maxLength={40}
          onChange={event => { setError(null); setCodeInput(formatRecoveryCode(normalizeRecoveryCode(event.target.value))); }}/>
        <small>{tr('Znajdziesz go na pierwszym urządzeniu: Ustawienia → Synchronizacja w chmurze → Kod odzyskiwania.', 'You’ll find it on your first device: Settings → Cloud sync → Recovery code.')}</small>
      </label>
      {!preview ? <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={normalized.length < 24 || busy}
          onClick={() => { void run('check', async () => { setPreview(await engine.previewLink(codeInput)); }); }}>
          <Link2 size={16}/>{working === 'check' ? tr('Sprawdzam…', 'Checking…') : tr('Sprawdź kod', 'Check code')}
        </button>
        <button type="button" className="btn btn--secondary" onClick={closeLink}>{tr('Anuluj', 'Cancel')}</button>
      </div> : <div className="backup-import-preview cloud-sync-preview">
        <div className="backup-import-title"><Cloud size={22}/><div><strong>{tr('Dane w chmurze', 'Data in the cloud')}</strong><small>{tr('Ostatni zapis:', 'Last saved:')} {relativeTime(preview.remote.updatedAt, now)}</small></div></div>
        <div className="backup-counts">
          <span><strong>{preview.remote.preview.tasks}</strong>{tasksWord(preview.remote.preview.tasks)}</span>
          <span><strong>{preview.remote.preview.projects}</strong>{projectsWord(preview.remote.preview.projects)}</span>
          <span><strong>{preview.remote.preview.routines}</strong>{routinesWord(preview.remote.preview.routines)}</span>
          <span><strong>{preview.remote.preview.focusSessions}</strong>{focusSessionsWord(preview.remote.preview.focusSessions)}</span>
        </div>
        <p className="backup-import-warning"><AlertTriangle size={17}/><span>{pick(
          <>Połączenie <strong>zastąpi wszystkie dane Momentum na tym urządzeniu</strong> (teraz: {tasksLabel(data.tasks.length)}) danymi z chmury.</>,
          <>Linking <strong>will replace all Momentum data on this device</strong> (currently: {tasksLabel(data.tasks.length)}) with the data from the cloud.</>,
        )}</span></p>
        <label className="backup-confirm-label"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/><span>{tr('Rozumiem, że obecne dane na tym urządzeniu zostaną zastąpione.', 'I understand that the current data on this device will be replaced.')}</span></label>
        <div className="cloud-sync-actions">
          <button type="button" className="btn btn--danger" disabled={!accepted || busy}
            onClick={() => { void run('link', () => engine.confirmLink(preview.code)); }}>
            <CloudDownload size={16}/>{working === 'link' ? tr('Wczytuję…', 'Loading…') : tr('Połącz i wczytaj dane', 'Link and load data')}
          </button>
          <button type="button" className="btn btn--secondary" disabled={busy} onClick={closeLink}>{tr('Anuluj', 'Cancel')}</button>
        </div>
      </div>}
      {messages}
    </section>;
  }

  if (!state.enabled) {
    return <section className="cloud-sync" id={CLOUD_SYNC_PANEL_ID} aria-labelledby="cloud-sync-title">
      {heading}
      <p className={`cloud-sync-server ${server ? (server.ok ? 'is-ok' : 'is-down') : ''}`} role="status">
        <span aria-hidden="true"/>{server ? (server.ok ? tr('Serwer synchronizacji jest gotowy.', 'The sync server is ready.') : server.message) : tr('Sprawdzam serwer…', 'Checking the server…')}
      </p>
      {state.code && <p className="cloud-sync-note">{pick(
        <>Synchronizacja jest wyłączona na tym urządzeniu. Zapamiętany kod kończy się na <b>{state.code.slice(-4)}</b>.</>,
        <>Sync is turned off on this device. The saved code ends in <b>{state.code.slice(-4)}</b>.</>,
      )}</p>}
      <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={busy || server?.ok === false}
          onClick={() => { void run('enable', () => engine.enable(), state.code
            ? tr('Synchronizacja włączona ponownie.', 'Sync is back on.')
            : tr('Gotowe — synchronizacja działa. Zapisz kod odzyskiwania: tylko nim połączysz nowy telefon.', 'Done — sync is on. Save your recovery code: it’s the only way to link a new phone.')); }}>
          <CloudUpload size={16}/>{working === 'enable' ? tr('Włączam…', 'Turning on…') : state.code ? tr('Włącz ponownie', 'Turn on again') : tr('Włącz synchronizację', 'Turn on sync')}
        </button>
        <button type="button" className="btn btn--secondary" disabled={busy || server?.ok === false} onClick={() => { setNotice(null); setView('link'); }}>
          <Link2 size={16}/> {tr('Mam kod z innego urządzenia', 'I have a code from another device')}
        </button>
      </div>
      <p className="cloud-sync-note"><KeyRound size={14}/><span>{tr('Po włączeniu dostaniesz 24-znakowy kod odzyskiwania. Działa jak hasło: zapisz go, bo tylko nim połączysz nowy telefon z danymi w chmurze.', 'Once sync is on, you’ll get a 24-character recovery code. It works like a password: save it, because it’s the only way to link a new phone to your data in the cloud.')}</span></p>
      {state.code && <button type="button" className="cloud-sync-text-btn" disabled={busy}
        onClick={() => { if (window.confirm(tr('Zapomnieć kod na tym urządzeniu? Dane w chmurze zostaną, ale bez kodu nie da się ich odzyskać.', 'Forget the code on this device? Your data in the cloud will stay, but it can’t be recovered without the code.'))) engine.forget(); }}>
        {tr('Zapomnij kod na tym urządzeniu', 'Forget the code on this device')}
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
      <button type="button" className="cloud-sync-icon-btn" disabled={busy} aria-label={tr('Synchronizuj teraz', 'Sync now')} title={tr('Synchronizuj teraz', 'Sync now')}
        onClick={() => { void run('sync', () => engine.syncNow()); }}>
        <RefreshCw size={17}/>
      </button>
    </div>
    {messages}

    {state.phase === 'conflict' && state.remote && <div className="cloud-sync-choice">
      <p>{pick(
        <><strong>Nie udało się automatycznie połączyć zmian</strong> (brak wspólnej wersji, np. po aktualizacji aplikacji). Wybierz wersję do zachowania. Jeśli zachowasz tę z urządzenia, wersja z chmury trafi do historii.</>,
        <><strong>The changes couldn’t be merged automatically</strong> (there’s no common version, e.g. after an app update). Choose which version to keep. If you keep the one from this device, the cloud version will be saved in the history.</>,
      )}</p>
      <div className="cloud-sync-compare">
        <div><span><Smartphone size={14}/> {tr('To urządzenie', 'This device')}</span><b>{tasksLabel(data.tasks.length)}</b><small>{routinesLabel(data.routines.length)} · {tr('teraz', 'now')}</small></div>
        <div><span><Cloud size={14}/> {tr('Chmura', 'Cloud')}</span><b>{tasksLabel(state.remote.preview.tasks)}</b><small>{routinesLabel(state.remote.preview.routines)} · {relativeTime(state.remote.updatedAt, now)}</small></div>
      </div>
      <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => { void run('keep', () => engine.keepLocal(), tr('Zachowano dane z tego urządzenia. Poprzednia wersja z chmury jest w historii.', 'Kept the data from this device. The previous cloud version is in the history.')); }}>
          <CloudUpload size={16}/> {tr('Zachowaj z tego urządzenia', 'Keep data from this device')}
        </button>
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => { void run('take', () => engine.takeRemote()); }}>
          <CloudDownload size={16}/> {tr('Wczytaj z chmury', 'Load from the cloud')}
        </button>
      </div>
      <small className="cloud-sync-hint">{tr('Nie masz pewności? Najpierw pobierz kopię JSON w sekcji poniżej.', 'Not sure? Download a JSON backup in the section below first.')}</small>
    </div>}

    {state.phase === 'update-ready' && <div className="cloud-sync-choice is-info">
      <p><strong>{tr('Na innym urządzeniu zapisano nowsze dane.', 'Newer data was saved on another device.')}</strong> {state.pendingLocal
        ? tr('Wczytanie połączy je ze zmianami z tego urządzenia i odświeży aplikację.', 'Loading will merge it with the changes from this device and refresh the app.')
        : tr('Wczytanie odświeży aplikację.', 'Loading will refresh the app.')}</p>
      <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => { void run('take', () => engine.loadUpdate()); }}>
          <CloudDownload size={16}/> {state.pendingLocal ? tr('Wczytaj i połącz', 'Load and merge') : tr('Wczytaj teraz', 'Load now')}
        </button>
      </div>
    </div>}

    {state.error === 'not-found' && <div className="cloud-sync-choice">
      <p>{tr('Możesz wysłać dane z tego urządzenia ponownie (ten sam kod) albo wyłączyć synchronizację.', 'You can upload the data from this device again (same code) or turn off sync.')}</p>
      <div className="cloud-sync-actions">
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => { void run('enable', () => engine.enable(), tr('Dane wysłane ponownie.', 'Data uploaded again.')); }}>
          <CloudUpload size={16}/> {tr('Wyślij dane ponownie', 'Upload data again')}
        </button>
      </div>
    </div>}

    <div className="cloud-sync-code">
      <div className="cloud-sync-code-label"><KeyRound size={15}/><span>{tr('Kod odzyskiwania', 'Recovery code')}</span></div>
      <code aria-label={revealed ? tr('Kod odzyskiwania', 'Recovery code') : tr('Kod odzyskiwania (ukryty)', 'Recovery code (hidden)')}>
        {revealed ? formatRecoveryCode(code) : `••••-••••-••••-••••-••••-${code.slice(-4)}`}
      </code>
      <div className="cloud-sync-code-actions">
        <button type="button" onClick={() => setRevealed(value => !value)}>{revealed ? <EyeOff size={15}/> : <Eye size={15}/>}{revealed ? tr('Ukryj', 'Hide') : tr('Pokaż', 'Show')}</button>
        <button type="button" onClick={() => { void copyCode(code); }}><Copy size={15}/>{tr('Kopiuj', 'Copy')}</button>
        <button type="button" onClick={() => { void shareCode(code); }}><Share2 size={15}/>{tr('Udostępnij', 'Share')}</button>
      </div>
      <small>{tr('Na nowym urządzeniu wybierz „Mam kod z innego urządzenia”. Kto zna kod, ma dostęp do Twoich danych.', 'On the new device, choose “I have a code from another device”. Anyone who knows the code can access your data.')}</small>
    </div>

    <CloudHistorySection engine={engine} busy={busy} now={now}/>

    <div className="cloud-sync-footer">
      <button type="button" className="cloud-sync-text-btn" disabled={working !== null} onClick={() => { engine.disable(); setNotice(tr('Synchronizacja wyłączona. Dane zostały na tym urządzeniu i w chmurze.', 'Sync turned off. Your data stays on this device and in the cloud.')); }}>
        <Power size={15}/> {tr('Wyłącz na tym urządzeniu', 'Turn off on this device')}
      </button>
      <button type="button" className="cloud-sync-text-btn is-danger" disabled={busy}
        onClick={() => {
          if (!window.confirm(tr('Usunąć dane Momentum z serwera? Dane na tym urządzeniu zostaną, ale inne połączone urządzenia przestaną się synchronizować.', 'Delete Momentum data from the server? The data on this device will stay, but other linked devices will stop syncing.'))) return;
          void run('delete', () => engine.deleteRemote(), tr('Usunięto dane z serwera. Dane na tym urządzeniu zostały bez zmian.', 'Data deleted from the server. The data on this device is unchanged.'));
        }}>
        <Trash2 size={15}/> {tr('Usuń dane z serwera', 'Delete data from the server')}
      </button>
    </div>
  </section>;
}

const REASON_LABELS: Record<CloudHistoryReason, Localized> = {
  daily: { pl: 'Kopia dzienna', en: 'Daily backup' },
  shrink: { pl: 'Przed usunięciem danych', en: 'Before data deletion' },
  manual: { pl: 'Przed zmianą wersji', en: 'Before version change' },
};

function savedAtLabel(iso: string, now: number): string {
  const date = new Date(iso);
  const clock = date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === today.toDateString()) return tr(`Dziś, ${clock}`, `Today, ${clock}`);
  if (date.toDateString() === yesterday.toDateString()) return tr(`Wczoraj, ${clock}`, `Yesterday, ${clock}`);
  const day = date.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
  return `${day.charAt(0).toLocaleUpperCase(locale())}${day.slice(1)}, ${clock}`;
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
    catch (cause) { setError(cause instanceof Error ? cause.message : tr('Nie udało się wczytać historii.', 'Couldn’t load the history.')); }
    finally { setLoading(false); }
  }
  async function openPreview(entry: CloudHistoryEntry) {
    setPreviewing(entry.revision);
    setError(null);
    setAccepted(false);
    try { setPreview({ entry, summary: await engine.previewHistory(entry.revision) }); }
    catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : tr('Nie udało się wczytać tej wersji.', 'Couldn’t load this version.')); }
    finally { setPreviewing(null); }
  }
  async function restore() {
    if (!preview) return;
    setRestoring(true);
    setError(null);
    try { await engine.restoreHistory(preview.entry.revision); }
    catch (cause) { setError(cause instanceof Error ? cause.message : tr('Nie udało się przywrócić wersji.', 'Couldn’t restore the version.')); setRestoring(false); }
  }

  const counts = preview?.summary.preview;
  return <div className="cloud-history">
    <div className="cloud-history-head">
      <span className="cloud-history-icon"><History size={16}/></span>
      <div><strong>{tr('Historia wersji', 'Version history')}</strong><small>{tr('Kopie z ostatnich 30 dni. Przywrócenie można cofnąć — obecna wersja też trafi do historii.', 'Backups from the last 30 days. Restoring can be undone — the current version is saved to the history too.')}</small></div>
    </div>
    {!open ? <button type="button" className="btn btn--secondary cloud-history-open" disabled={busy}
      onClick={() => { setOpen(true); void load(); }}><History size={16}/> {tr('Pokaż historię', 'Show history')}</button> : <>
      {loading && <p className="cloud-history-empty"><RefreshCw size={14} className="cloud-spin"/> {tr('Wczytuję historię…', 'Loading history…')}</p>}
      {!loading && entries?.length === 0 && <p className="cloud-history-empty">{tr('Na razie brak kopii. Pierwsza powstanie przy kolejnej zmianie danych, a potem raz dziennie — przy pierwszej zmianie danego dnia.', 'No backups yet. The first one will be made with your next data change, then once a day — with the first change of each day.')}</p>}
      {!loading && !!entries?.length && <ul className="cloud-history-list">
        {entries.map(entry => <li key={entry.revision} className={preview?.entry.revision === entry.revision ? 'is-selected' : ''}>
          <div><strong>{savedAtLabel(entry.savedAt, now)}</strong><small>{text(REASON_LABELS[entry.reason])}{entry.size ? ` · ${formatSize(entry.size)}` : ''}</small></div>
          <button type="button" disabled={busy || restoring || previewing !== null} onClick={() => { void openPreview(entry); }}>
            {previewing === entry.revision ? tr('Wczytuję…', 'Loading…') : tr('Podgląd', 'Preview')}
          </button>
        </li>)}
      </ul>}
      {preview && counts && <div className="backup-import-preview cloud-history-preview">
        <div className="backup-import-title"><History size={22}/><div><strong>{tr(`Wersja: ${savedAtLabel(preview.entry.savedAt, now).toLocaleLowerCase(locale())}`, `Version: ${savedAtLabel(preview.entry.savedAt, now)}`)}</strong><small>{text(REASON_LABELS[preview.entry.reason])}</small></div></div>
        <div className="backup-counts">
          <span><strong>{counts.tasks}</strong>{tasksWord(counts.tasks)}</span>
          <span><strong>{counts.projects}</strong>{projectsWord(counts.projects)}</span>
          <span><strong>{counts.routines}</strong>{routinesWord(counts.routines)}</span>
          <span><strong>{counts.focusSessions}</strong>{focusSessionsWord(counts.focusSessions)}</span>
        </div>
        <p className="backup-import-warning"><AlertTriangle size={17}/><span>{pick(
          <>Przywrócenie <strong>zastąpi obecne dane na tym i pozostałych urządzeniach</strong>. Obecna wersja trafi do historii, więc w razie potrzeby wrócisz do niej.</>,
          <>Restoring <strong>will replace the current data on this and your other devices</strong>. The current version will be saved to the history, so you can go back to it if needed.</>,
        )}</span></p>
        <label className="backup-confirm-label"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)}/><span>{tr('Rozumiem — przywróć tę wersję.', 'I understand — restore this version.')}</span></label>
        <div className="cloud-sync-actions">
          <button type="button" className="btn btn--danger" disabled={!accepted || restoring || busy} onClick={() => { void restore(); }}>
            <RotateCcw size={16}/>{restoring ? tr('Przywracam…', 'Restoring…') : tr('Przywróć tę wersję', 'Restore this version')}
          </button>
          <button type="button" className="btn btn--secondary" disabled={restoring} onClick={() => { setPreview(null); setAccepted(false); }}>{tr('Anuluj', 'Cancel')}</button>
        </div>
      </div>}
      {error && <div className="backup-message backup-message--error" role="alert"><AlertTriangle size={16}/>{error}</div>}
      {!loading && <button type="button" className="cloud-sync-text-btn cloud-history-refresh" disabled={busy || restoring} onClick={() => { setPreview(null); void load(); }}>
        <RefreshCw size={14}/> {tr('Odśwież listę', 'Refresh list')}
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
      <strong>{conflict ? tr('Zmiany na dwóch urządzeniach', 'Changes on two devices') : tr('Nowe dane z innego urządzenia', 'New data from another device')}</strong>
      <small>{conflict ? tr('Wybierz, którą wersję zachować.', 'Choose which version to keep.')
        : state.pendingLocal ? tr('Wczytaj — połączę je z Twoimi zmianami.', 'Load to merge it with your changes.')
        : tr('Wczytaj, aby zobaczyć aktualny plan.', 'Load to see the latest plan.')}</small>
    </div>
    <button type="button" className="cloud-banner-action" disabled={working}
      onClick={() => {
        if (conflict) { onResolve(); return; }
        setWorking(true);
        void engine.loadUpdate().finally(() => setWorking(false));
      }}>
      {conflict ? tr('Wybierz', 'Choose') : working ? tr('Wczytuję…', 'Loading…') : tr('Wczytaj', 'Load')}
    </button>
  </div>;
}
