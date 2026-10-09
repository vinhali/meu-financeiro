import { useRef, useState } from 'react';
import { api } from '../api';

interface Props {
  currentScenarioId: string;
  onImported: () => void;
  notify: (type: 'success' | 'error', msg: string) => void;
}

export default function BackupBar({ currentScenarioId, onImported, notify }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  function exportCurrent() {
    window.location.href = api.exportUrl(currentScenarioId);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const scenarioPayloads: any[] = Array.isArray(json.scenarios) ? json.scenarios : [json];
      for (const payload of scenarioPayloads) {
        await api.importScenario(payload);
      }
      notify('success', `${scenarioPayloads.length} cenário(s) importado(s).`);
      onImported();
    } catch (e) {
      notify('error', e instanceof Error ? e.message : 'Falha ao importar backup');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="backup-bar">
      <button className="reset" onClick={exportCurrent} disabled={busy}>
        Exportar backup
      </button>
      <button className="reset" onClick={() => fileInputRef.current?.click()} disabled={busy}>
        Importar backup
      </button>
      <input ref={fileInputRef} type="file" accept="application/json" onChange={handleFile} />
    </div>
  );
}
