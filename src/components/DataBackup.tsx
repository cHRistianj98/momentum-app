import { useRef, useState } from 'react';
import { getMomentumSnapshot, getOfflineDatabaseStatus, syncOfflineSnapshot, verifyOfflineStorage, type OfflineIntegrityReport } from '../lib/offlineDatabase';
import { AlertTriangle, CheckCircle2, Download, FileJson, HardDriveDownload, ShieldCheck, Upload, X, Database, RefreshCw } from 'lucide-react';
import type { AppData } from '../types';
import {
  MAX_BACKUP_BYTES, backupFilename, createMomentumBackup, encodeMomentumBackup,
  parseMomentumBackup, restoreMomentumBackup, type BackupPreview, type MomentumBackup,
} from '../lib/backup';
import { count, locale, pick, plural, tr } from '../lib/i18n';

const LAST_CONFIRMED_BACKUP_KEY = 'momentum-backup-confirmed-at.v1'; // local UI metadata, not part of exported Momentum data
const REMIND_AFTER_DAYS = 7;

/** Słowo przy liczbie w podglądzie importu: po polsku bez zmian (jak dotąd, bez odmiany), po angielsku 1 task / 2 tasks. */
const unit = (value: number, pl: string, en: readonly [string, string]) => plural(value, [pl, pl, pl], en);

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
        throw new Error(tr('Nie udało się potwierdzić kompletności kopii danych.', 'Couldn’t verify that the backup is complete.'));
      }
      if (new Blob([contents]).size > MAX_BACKUP_BYTES) {
        throw new Error(tr('Dane są zbyt duże, aby utworzyć kopię JSON (limit 10 MB).', 'Your data is too large for a JSON backup (10 MB limit).'));
      }
      const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
      const file = new File([blob], backupFilename(), { type: 'application/json' });

      // iPhone: native share sheet lets the user choose "Zachowaj w Plikach"
      // and then iCloud Drive. Do not fall back to download if sharing was cancelled.
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: tr('Kopia zapasowa Momentum', 'Momentum backup') });
          setAwaitingBackupConfirmation(true);
          setNotice(tr(
            'Menu udostępniania zostało zamknięte. Sprawdź w Plikach/iCloud Drive, czy kopia naprawdę została zapisana.',
            'The share sheet was closed. Check in Files/iCloud Drive that the backup was really saved.',
          ));
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
      setNotice(tr(
        'Rozpoczęto pobieranie kopii. Zapisz ją w Plikach → iCloud Drive i sprawdź, czy plik jest widoczny.',
        'The backup download has started. Save it in Files → iCloud Drive and check that the file is visible.',
      ));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('Nie udało się wyeksportować danych.', 'Couldn’t export your data.'));
    }
  }

  async function inspectFile(file: File | undefined) {
    setError(null);
    setNotice(null);
    setImported(null);
    setAccepted(false);
    if (!file) return;
    if (file.size > MAX_BACKUP_BYTES) {
      setError(tr('Ten plik przekracza limit 10 MB. Wybierz mniejszą kopię Momentum.', 'This file exceeds the 10 MB limit. Choose a smaller Momentum backup.'));
      return;
    }
    setIsReading(true);
    try {
      const content = await file.text();
      const { backup, preview } = parseMomentumBackup(content);
      setImported({ filename: file.name, backup, preview });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('Nie udało się odczytać kopii.', 'Couldn’t read the backup.'));
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
      setError(cause instanceof Error ? cause.message : tr('Nie udało się przywrócić kopii.', 'Couldn’t restore the backup.'));
    }
  }

  async function inspectLocalStorage() {
    setChecking(true);
    setIntegrity(null);
    setError(null);
    try {
      setIntegrity(await verifyOfflineStorage());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tr('Nie udało się sprawdzić lokalnego zapisu.', 'Couldn’t check the local storage.'));
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
      setNotice(tr(
        'Potwierdzono zapis kopii poza Momentum. Zachowaj plik w iCloud Drive lub innym bezpiecznym miejscu.',
        'Confirmed that the backup is saved outside Momentum. Keep the file in iCloud Drive or another safe place.',
      ));
    } catch { setError(tr('Nie udało się zapamiętać daty kopii. Sam plik JSON pozostaje bez zmian.', 'Couldn’t save the backup date. The JSON file itself is unchanged.')); }
  }

  const daysSinceBackup = lastBackup ? Math.max(0, Math.floor((Date.now() - Date.parse(lastBackup)) / 86_400_000)) : null;
  const reminderDue = daysSinceBackup === null || daysSinceBackup >= REMIND_AFTER_DAYS;

  return <section className="backup-settings" aria-labelledby="backup-section-title">
    <div className="backup-settings-heading">
      <span className="backup-settings-symbol"><ShieldCheck size={21} /></span>
      <div><h3 id="backup-section-title">{tr('Bezpieczeństwo danych', 'Data safety')}</h3><p>{tr('Kopia JSON obejmuje zadania, projekty, rutyny, Focus Mode, pomiary, odznaki i plany tygodniowe.', 'The JSON backup includes tasks, projects, routines, Focus Mode, measurements, badges and weekly plans.')}</p></div>
    </div>
    <div className="backup-actions">
      <button type="button" className="btn btn--primary" onClick={()=>{void downloadBackup();}}><Download size={16} /> {tr('Pobierz kopię JSON', 'Download JSON backup')}</button>
      <button type="button" className="btn btn--secondary" disabled={isReading} onClick={() => fileInput.current?.click()}><Upload size={16} /> {isReading ? tr('Wczytywanie…', 'Reading…') : tr('Importuj kopię', 'Import backup')}</button>
      <input ref={fileInput} type="file" accept=".json,application/json" className="backup-file-input" aria-label={tr('Wybierz kopię Momentum w formacie JSON', 'Choose a Momentum backup in JSON format')} onChange={event => void inspectFile(event.currentTarget.files?.[0])} />
    </div>
    <p className="backup-settings-hint"><HardDriveDownload size={15} /> {getOfflineDatabaseStatus() === 'ready'
      ? tr('Dane są zapisywane również w IndexedDB. Eksport JSON nie usuwa niczego z aplikacji.', 'Your data is also saved in IndexedDB. Exporting JSON doesn’t remove anything from the app.')
      : tr('IndexedDB jest niedostępne. Pobierz backup JSON, bo dane są tylko w pamięci przeglądarki.', 'IndexedDB is unavailable. Download a JSON backup, because your data is only in the browser’s storage.')}</p>
    <div className="backup-health">
      <div className="backup-health-label"><Database size={17}/><span><strong>{tr('Kontrola lokalnych danych', 'Local data check')}</strong><small>{tr('Porównuje zapis aplikacji z IndexedDB; niczego nie usuwa.', 'Compares the app’s saved data with IndexedDB; doesn’t delete anything.')}</small></span></div>
      <button type="button" className="btn btn--secondary" disabled={checking} onClick={() => { void inspectLocalStorage(); }}><RefreshCw size={15}/>{checking ? tr('Sprawdzanie…', 'Checking…') : tr('Sprawdź zapis', 'Check storage')}</button>
      {integrity && <p role="status" className={`backup-health-result ${integrity.consistent ? 'backup-health-result--ok' : 'backup-health-result--warn'}`}>
        {integrity.consistent ? <CheckCircle2 size={16}/> : <AlertTriangle size={16}/>}
        {integrity.consistent
          ? tr(`Zapis jest spójny: sprawdzono ${integrity.keysChecked} elementów.`,
            `Storage is consistent: ${count(integrity.keysChecked, ['element', 'elementy', 'elementów'], ['item', 'items'])} checked.`)
          : integrity.status === 'local-only' ? tr('IndexedDB nie jest dostępne. Zapisz kopię JSON poza telefonem.', 'IndexedDB isn’t available. Save a JSON backup outside your phone.')
          : !integrity.dataValid ? tr('Nie można potwierdzić poprawności głównych danych. Nie resetuj aplikacji — wyeksportuj kopię JSON.', 'The main data can’t be confirmed as valid. Don’t reset the app — export a JSON backup.')
          : tr(`Wykryto niespójności (${integrity.mismatchedKeys} elementów). Zrób kopię JSON i nie usuwaj aplikacji.`,
            `Inconsistencies found (${count(integrity.mismatchedKeys, ['element', 'elementy', 'elementów'], ['item', 'items'])}). Make a JSON backup and don’t delete the app.`)}
      </p>}
    </div>
    <div className="backup-health backup-health--external">
      <div className="backup-health-label"><HardDriveDownload size={17}/><span><strong>{tr('Kopia poza iPhonem', 'Backup outside your iPhone')}</strong><small>{lastBackup ? `${tr('Ostatnia potwierdzona:', 'Last confirmed:')} ${new Date(lastBackup).toLocaleDateString(locale())}` : tr('Brak potwierdzonej kopii w iCloud Drive / Plikach.', 'No confirmed backup in iCloud Drive / Files.')}</small></span></div>
      {reminderDue && <p className="backup-health-reminder">{daysSinceBackup === null
        ? tr('Po pierwszym eksporcie zapisz kopię w iCloud Drive.', 'After your first export, save the backup in iCloud Drive.')
        : tr(`Od potwierdzonego backupu minęło ${daysSinceBackup} dni. Zrób nową kopię.`,
          `It’s been ${count(daysSinceBackup, ['dzień', 'dni', 'dni'], ['day', 'days'])} since your last confirmed backup. Make a new one.`)}</p>}
      {awaitingBackupConfirmation && <button type="button" className="btn btn--secondary" onClick={confirmExternalBackup}><CheckCircle2 size={15}/> {tr('Potwierdzam zapis pliku poza aplikacją', 'I confirm the file is saved outside the app')}</button>}
    </div>
    {notice && <div className="backup-message backup-message--success" role="status"><CheckCircle2 size={16} />{notice}</div>}
    {error && <div className="backup-message backup-message--error" role="alert"><AlertTriangle size={16} />{error}</div>}

    {imported && <div className="backup-import-preview" aria-label={tr('Podgląd pliku do importu', 'Preview of the file to import')}>
      <div className="backup-import-title"><FileJson size={22} /><div><strong>{imported.filename}</strong><small>{tr('Utworzono:', 'Created:')} {new Date(imported.preview.createdAt).toLocaleString(locale())}</small></div><button type="button" className="backup-dismiss" title={tr('Anuluj import', 'Cancel import')} aria-label={tr('Anuluj import', 'Cancel import')} onClick={() => { setImported(null); setAccepted(false); }}><X size={16}/></button></div>
      <div className="backup-counts">
        <span><strong>{imported.preview.tasks}</strong> {unit(imported.preview.tasks, 'zadań', ['task', 'tasks'])}</span>
        <span><strong>{imported.preview.projects}</strong> {unit(imported.preview.projects, 'projektów', ['project', 'projects'])}</span>
        <span><strong>{imported.preview.routines}</strong> {unit(imported.preview.routines, 'rutyn', ['routine', 'routines'])}</span>
        <span><strong>{imported.preview.focusSessions}</strong> {unit(imported.preview.focusSessions, 'sesji Focus', ['Focus session', 'Focus sessions'])}</span>
      </div>
      <p className="backup-import-warning"><AlertTriangle size={17} /> {pick(
        <>Import <strong>zastąpi wszystkie obecne dane Momentum na tym urządzeniu</strong>, także historię Focus i osiągnięcia. Przed importem pobierz kopię aktualnych danych. Import nie scala dwóch kalendarzy.</>,
        <>Importing <strong>will replace all current Momentum data on this device</strong>, including your Focus history and achievements. Download a backup of your current data before importing. Importing doesn’t merge two calendars.</>,
      )}</p>
      <label className="backup-confirm-label"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /><span>{tr('Rozumiem, że dotychczasowe dane na tym urządzeniu zostaną zastąpione.', 'I understand that the existing data on this device will be replaced.')}</span></label>
      <button type="button" className="btn btn--danger backup-confirm-button" disabled={!accepted || isReading} onClick={()=>{void confirmImport();}}><Upload size={16}/> {tr('Zastąp dane i uruchom ponownie', 'Replace data and restart')}</button>
    </div>}
  </section>;
}
