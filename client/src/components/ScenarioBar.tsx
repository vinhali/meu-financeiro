import { Scenario } from '../types';

interface Props {
  scenarios: Scenario[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onLogout: () => void;
  // Elemento extra da barra (o sino de alertas), antes do menu do cenário.
  extra?: React.ReactNode;
}

export default function ScenarioBar({ scenarios, selectedId, onSelect, onCreate, onDuplicate, onRename, onDelete, onLogout, extra }: Props) {
  const selected = scenarios.find((s) => s.id === selectedId);
  // Fecha o menu depois de escolher uma ação.
  const run = (action: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.closest('details')?.removeAttribute('open');
    action();
  };

  return (
    <div className="topbar-end">
      <div className="scenario-bar">
        <select aria-label="Cenário financeiro" value={selectedId} onChange={(e) => onSelect(e.target.value)}>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.isBase ? ' (base)' : ''}
            </option>
          ))}
        </select>
      </div>
      {extra}
      <details className="menu">
        <summary aria-label="Gerenciar cenários">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.800-1.200l-.1.1a2 2 0 1 1-2.9-2.900l.1-.1A1.7 1.7 0 0 0 3.100 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.200-2.800l-.1-.1a2 2 0 1 1 2.900-2.900l.1.1A1.7 1.7 0 0 0 10 3.100V3a2 2 0 1 1 4 0v.1a1.700 1.700 0 0 0 2.800 1.200l.1-.1a2 2 0 1 1 2.900 2.900l-.1.1a1.700 1.700 0 0 0 1.200 2.800H21a2 2 0 1 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1z" />
          </svg>
          <span>Cenário</span>
        </summary>
        <div className="menu-list">
          <button onClick={run(onCreate)}>Novo cenário</button>
          <button onClick={run(onDuplicate)}>Duplicar este</button>
          <button onClick={run(onRename)}>Renomear</button>
          <hr />
          <button className="danger" onClick={run(onDelete)} disabled={selected?.isBase} title={selected?.isBase ? 'O cenário base não pode ser excluído' : ''}>
            Excluir
          </button>
        </div>
      </details>
      <button className="btn-ghost" onClick={onLogout}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
        </svg>
        <span>Sair</span>
      </button>
    </div>
  );
}
