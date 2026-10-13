import { useRef, useState } from 'react';
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

  function downloadBackup() {
    setError(null);
    setNotice(null);
    try {
      const backup = createMomentumBackup(window.localStorage, data);
      const contents = encodeMomentumBackup(backup);
      if (new Blob([contents]).size > MAX_BACKUP_BYTES) throw new Error('Dane są zbyt duże, aby utworzyć kopię JSON (limit 10 MB).');
      const blob = new Blob([contents], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFilename();
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice('Rozpoczęto pobieranie kopii. Zachowaj plik w bezpiecznym miejscu.');
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

  function confirmImport() {
    if (!imported || !accepted) return;
    setError(null);
    try {
      restoreMomentumBackup(window.localStorage, imported.backup);
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
      <button type="button" className="btn btn--primary" onClick={downloadBackup}><Download size={16} /> Pobierz kopię JSON</button>
      <button type="button" className="btn btn--secondary" disabled={isReading} onClick={() => fileInput.current?.click()}><Upload size={16} /> {isReading ? 'Wczytywanie…' : 'Importuj kopię'}</button>
      <input ref={fileInput} type="file" accept=".json,application/json" className="backup-file-input" aria-label="Wybierz kopię Momentum w formacie JSON" onChange={event => void inspectFile(event.currentTarget.files?.[0])} />
    </div>
    <p className="backup-settings-hint"><HardDriveDownload size={15} /> Dane pozostają na tym urządzeniu. Eksport nie usuwa niczego z aplikacji.</p>
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
      <button type="button" className="btn btn--danger backup-confirm-button" disabled={!accepted || isReading} onClick={confirmImport}><Upload size={16}/> Zastąp dane i uruchom ponownie</button>
    </div>}
  </section>;
}
