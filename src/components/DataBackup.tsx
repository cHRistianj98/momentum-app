import { useRef, useState } from 'react';
import { getMomentumSnapshot, getOfflineDatabaseStatus, syncOfflineSnapshot, verifyOfflineStorage, type OfflineIntegrityReport } from '../lib/offlineDatabase';
import { AlertTriangle, CheckCircle2, Download, FileJson, HardDriveDownload, ShieldCheck, Upload, X, Database, RefreshCw } from 'lucide-react';
import type { AppData } from '../types';
import {
  MAX_BACKUP_BYTES, backupFilename, createMomentumBackup, encodeMomentumBackup,
  parseMomentumBackup, restoreMomentumBackup, type BackupPreview, type MomentumBackup,
} from '../lib/backup';

const LAST_CONFIRMED_BACKUP_KEY = 'momentum-backup-confirmed-at.v1'; // local UI metadata, not part of exported Momentum data
const REMIND_AFTER_DAYS = 7;

function lastConfirmedDate(): string | null {
  try {
    const value = localStorage.getItem(LAST_CONFIRMED_BACKUP_KEY);
    return value && Number.isFinite(Date.parse(value)) ? value : null;
  } catch { return null; }
}

interface ImportedFile {
  filename: string;
  backup: MomentumBackup;
  preview: BackupPreview;
}

export function DataBackup({ data }: { data: AppData }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [imported, setImported] = useState<ImportedFile | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<OfflineIntegrityReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [awaitingBackupConfirmation, setAwaitingBackupConfirmation] = useState(false);
  const [lastBackup, setLastBackup] = useState(lastConfirmedDate);

  async function downloadBackup() {
    setAwaitingBackupConfirmation(false);
    setError(null);
    setNotice(null);
    try {
      const snapshot = getMomentumSnapshot();
      const keys = Object.keys(snapshot);
      const memoryStorage = {
        get length() { return keys.length; },
        key: (index: number) => keys[index] ?? null,
        getItem: (key: string) => snapshot[key] ?? null,
        setItem: (key: string, value: string) => { snapshot[key] = value; if (!keys.includes(key)) keys.push(key); },
        removeItem: (key: string) => { delete snapshot[key]; const index = keys.indexOf(key); if (index !== -1) keys.splice(index, 1); },
      };
      const backup = createMomentumBackup(memoryStorage, data);
      const contents = encodeMomentumBackup(backup);
      // Check the exact file content before offering it to the user.
      const verified = parseMomentumBackup(contents);
      if (verified.preview.tasks !== data.tasks.length || verified.preview.routines !== data.routines.length) {
        throw new Error('Nie udało się potwierdzić kompletności kopii danych.');
      }
      if (new Blob([contents]).size > MAX_BACKUP_BYTES) throw new Error('Dane są zbyt duże, aby utworzyć kopię JSON (limit 10 MB).');
      const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
      const file = new File([blob], backupFilename(), { type: 'application/json' });

      // iPhone: native share sheet lets the user choose "Zachowaj w Plikach"
      // and then iCloud Drive. Do not fall back to download if sharing was cancelled.
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Kopia zapasowa Momentum' });
          setAwaitingBackupConfirmation(true);
          setNotice('Menu udostępniania zostało zamknięte. Sprawdź w Plikach/iCloud Drive, czy kopia naprawdę została zapisana.');
          return;
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
          // Not every iOS/WebKit version supports sharing JSON files; download fallback below.
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setAwaitingBackupConfirmation(true);
      setNotice('Rozpoczęto pobieranie kopii. Zapisz ją w Plikach → iCloud Drive i sprawdź, czy plik jest widoczny.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się wyeksportować danych.');
    }
  }

  async function inspectFile(file: File | undefined) {
    setError(null);
    setNotice(null);
    setImported(null);
    setAccepted(false);
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setError('Ten plik przekracza limit 10 MB. Wybierz mniejszą kopię Momentum.');
      return;
    }
    setIsReading(true);
    try {
      const content = await file.text();
      const { backup, preview } = parseMomentumBackup(content);
      setImported({ filename: file.name, backup, preview });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się odczytać kopii.');
    } finally {
      setIsReading(false);
      // Umożliwia wybranie ponownie dokładnie tego samego pliku.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function confirmImport() {
    if (!imported || !accepted) return;
    setError(null);
    try {
      restoreMomentumBackup(window.localStorage, imported.backup);
      await syncOfflineSnapshot();
      // Restored data may differ from the last externally saved backup.
      try { localStorage.removeItem(LAST_CONFIRMED_BACKUP_KEY); } catch { /* optional metadata */ }
      // Odświeżenie wczytuje importowane dane do React, Focus Mode i Weekly Review.
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się przywrócić kopii.');
    }
  }

  async function inspectLocalStorage() {
    setChecking(true);
    setIntegrity(null);
    setError(null);
    try {
      setIntegrity(await verifyOfflineStorage());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się sprawdzić lokalnego zapisu.');
    } finally {
      setChecking(false);
    }
  }

  function confirmExternalBackup() {
    const timestamp = new Date().toISOString();
    try {
      localStorage.setItem(LAST_CONFIRMED_BACKUP_KEY, timestamp);
      setLastBackup(timestamp);
      setAwaitingBackupConfirmation(false);
      setNotice('Potwierdzono zapis kopii poza Momentum. Zachowaj plik w iCloud Drive lub innym bezpiecznym miejscu.');
    } catch { setError('Nie udało się zapamiętać daty kopii. Sam plik JSON pozostaje bez zmian.'); }
  }

  const daysSinceBackup = lastBackup ? Math.max(0, Math.floor((Date.now() - Date.parse(lastBackup)) / 86_400_000)) : null;
  const reminderDue = daysSinceBackup === null || daysSinceBackup >= REMIND_AFTER_DAYS;

  return <section className="backup-settings" aria-labelledby="backup-section-title">
    <div className="backup-settings-heading">
      <span className="backup-settings-symbol"><ShieldCheck size={21} /></span>
      <div><h3 id="backup-section-title">Bezpieczeństwo danych</h3><p>Kopia JSON obejmuje zadania, projekty, rutyny, Focus Mode, pomiary, odznaki i plany tygodniowe.</p></div>
    </div>
    <div className="backup-actions">
      <button type="button" className="btn btn--primary" onClick={()=>{void downloadBackup();}}><Download size={16} /> Pobierz kopię JSON</button>
      <button type="button" className="btn btn--secondary" disabled={isReading} onClick={() => fileInput.current?.click()}><Upload size={16} /> {isReading ? 'Wczytywanie…' : 'Importuj kopię'}</button>
      <input ref={fileInput} type="file" accept=".json,application/json" className="backup-file-input" aria-label="Wybierz kopię Momentum w formacie JSON" onChange={event => void inspectFile(event.currentTarget.files?.[0])} />
    </div>
    <p className="backup-settings-hint"><HardDriveDownload size={15} /> {getOfflineDatabaseStatus() === 'ready' ? 'Dane są zapisywane również w IndexedDB. Eksport JSON nie usuwa niczego z aplikacji.' : 'IndexedDB jest niedostępne. Pobierz backup JSON, bo dane są tylko w pamięci przeglądarki.'}</p>
    <div className="backup-health">
      <div className="backup-health-label"><Database size={17}/><span><strong>Kontrola lokalnych danych</strong><small>Porównuje zapis aplikacji z IndexedDB; niczego nie usuwa.</small></span></div>
      <button type="button" className="btn btn--secondary" disabled={checking} onClick={() => { void inspectLocalStorage(); }}><RefreshCw size={15}/>{checking ? 'Sprawdzanie…' : 'Sprawdź zapis'}</button>
      {integrity && <p role="status" className={`backup-health-result ${integrity.consistent ? 'backup-health-result--ok' : 'backup-health-result--warn'}`}>
        {integrity.consistent ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}
        {integrity.consistent
          ? `Zapis jest spójny: sprawdzono ${integrity.keysChecked} elementów.`
          : integrity.status === 'local-only' ? 'IndexedDB nie jest dostępne. Zapisz kopię JSON poza telefonem.'
          : !integrity.dataValid ? 'Nie można potwierdzić poprawności głównych danych. Nie resetuj aplikacji — wyeksportuj kopię JSON.'
          : `Wykryto niespójności (${integrity.mismatchedKeys} elementów). Zrób kopię JSON i nie usuwaj aplikacji.`}
      </p>}
    </div>
    <div className="backup-health backup-health--external">
      <div className="backup-health-label"><HardDriveDownload size={17}/><span><strong>Kopia poza iPhonem</strong><small>{lastBackup ? `Ostatnia potwierdzona: ${new Date(lastBackup).toLocaleDateString('pl-PL')}` : 'Brak potwierdzonej kopii w iCloud Drive / Plikach.'}</small></span></div>
      {reminderDue && <p className="backup-health-reminder">{daysSinceBackup === null ? 'Po pierwszym eksporcie zapisz kopię w iCloud Drive.' : `Od potwierdzonego backupu minęło ${daysSinceBackup} dni. Zrób nową kopię.`}</p>}
      {awaitingBackupConfirmation && <button type="button" className="btn btn--secondary" onClick={confirmExternalBackup}><CheckCircle2 size={15}/> Potwierdzam zapis pliku poza aplikacją</button>}
    </div>
    {notice && <div className="backup-message backup-message--success" role="status"><CheckCircle2 size={16} />{notice}</div>}
    {error && <div className="backup-message backup-message--error" role="alert"><AlertTriangle size={16} />{error}</div>}

    {imported && <div className="backup-import-preview" aria-label="Podgląd pliku do importu">
      <div className="backup-import-title"><FileJson size={22} /><div><strong>{imported.filename}</strong><small>Utworzono: {new Date(imported.preview.createdAt).toLocaleString('pl-PL')}</small></div><button type="button" className="backup-dismiss" title="Anuluj import" aria-label="Anuluj import" onClick={() => { setImported(null); setAccepted(false); }}><X size={16}/></button></div>
      <div className="backup-counts">
        <span><strong>{imported.preview.tasks}</strong> zadań</span>
        <span><strong>{imported.preview.projects}</strong> projektów</span>
        <span><strong>{imported.preview.routines}</strong> rutyn</span>
        <span><strong>{imported.preview.focusSessions}</strong> sesji Focus</span>
      </div>
      <p className="backup-import-warning"><AlertTriangle size={17} /> Import <strong>zastąpi wszystkie obecne dane Momentum na tym urządzeniu</strong>, także historię Focus i osiągnięcia. Przed importem pobierz kopię aktualnych danych. Import nie scala dwóch kalendarzy.</p>
      <label className="backup-confirm-label"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>Rozumiem, że dotychczasowe dane na tym urządzeniu zostaną zastąpione.</span></label>
      <button type="button" className="btn btn--danger backup-confirm-button" disabled={!accepted || isReading} onClick={()=>{void confirmImport();}}><Upload size={16}/> Zastąp dane i uruchom ponownie</button>
    </div>}
  </section>;
}
