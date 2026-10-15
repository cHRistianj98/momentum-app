import { useRef, useState } from 'react';
import { getMomentumSnapshot, getOfflineDatabaseStatus, syncOfflineSnapshot } from '../lib/offlineDatabase';
import { AlertTriangle, CheckCircle2, Download, FileJson, HardDriveDownload, ShieldCheck, Upload, X } from 'lucide-react';
import type { AppData } from '../types';
import {
  MAX_BACKUP_BYTES, backupFilename, createMomentumBackup, encodeMomentumBackup,
  parseMomentumBackup, restoreMomentumBackup, type BackupPreview, type MomentumBackup,
} from '../lib/backup';

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

  async function downloadBackup() {
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
      if (new Blob([contents]).size > MAX_BACKUP_BYTES) throw new Error('Dane są zbyt duże, aby utworzyć kopię JSON (limit 10 MB).');
      const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
      const file = new File([blob], backupFilename(), { type: 'application/json' });

      // iPhone: native share sheet lets the user choose "Zachowaj w Plikach"
      // and then iCloud Drive. Do not fall back to download if sharing was cancelled.
      if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Kopia zapasowa Momentum' });
          setNotice('Udostępniono kopię. Upewnij się, że zapisano plik poza aplikacją, najlepiej na iCloud Drive.');
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
      setNotice('Rozpoczęto pobieranie kopii. Przenieś plik do Plików → iCloud Drive.');
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
      // Odświeżenie wczytuje importowane dane do React, Focus Mode i Weekly Review.
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się przywrócić kopii.');
    }
  }

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
