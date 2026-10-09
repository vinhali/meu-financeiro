import { useState } from 'react';
import { fmt } from '../calc';
import { MonthArchive } from '../types';

// Meses retirados da planilha: continuam guardados, com os valores que tinham, e podem voltar.
export default function HistorySection({ archives, onRestore }: { archives: MonthArchive[]; onRestore: (archive: MonthArchive) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (archives.length === 0) return null;
  const when = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', timeZone: 'America/Sao_Paulo' });
  return (
    <section className="hist">
      <h2>Histórico</h2>
      <p className="sub">Meses que você tirou da planilha. Os valores ficam guardados aqui e não entram nos totais acima.</p>
      <ul>
        {archives.map((a) => (
          <li key={a.id}>
            <div className="hist-head">
              <b>{a.label}</b>
              <small>guardado em {when(a.archivedAt)}</small>
              {(() => {
                // Mostra o que a planilha mostrava; sem esse registro, a soma dos valores digitados.
                const t = a.totals ?? a.typed;
                const note = a.totals
                  ? 'Como a planilha mostrava quando o mês foi retirado: o que estava nas faturas de cartão não é contado duas vezes.'
                  : 'Soma simples dos valores digitados: conta de novo o que estava dentro das faturas de cartão.';
                return (
                  <>
                    <span className="tag ok" title={note}>
                      entradas {fmt(t.entradas)}
                    </span>
                    <span className="tag high" title={note}>
                      gastos {fmt(t.saidas)}
                    </span>
                    <span className={`tag ${t.saldo >= 0 ? 'ok' : 'high'}`} title={note}>
                      saldo {fmt(t.saldo)}
                    </span>
                    {!a.totals && <span className="tag warn" title={note}>soma do digitado</span>}
                  </>
                );
              })()}
              <span className="hist-actions">
                <button type="button" className="tag-btn" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                  {open === a.id ? 'ocultar valores' : 'ver valores'}
                </button>
                <button type="button" className="tag-btn" onClick={() => onRestore(a)} title="Devolve este mês para a planilha, com os valores guardados">
                  restaurar na planilha
                </button>
              </span>
            </div>
            {open === a.id && (
              <div className="hist-rows">
                {(['entrada', 'saida'] as const).map((section) => (
                  <dl key={section}>
                    <dt>{section === 'entrada' ? 'Entradas' : 'Débitos'}</dt>
                    {a.rows
                      .filter((r) => r.section === section)
                      .map((r, i) => (
                        <div key={i} className={r.value ? undefined : 'zero'}>
                          <span>{r.name}</span>
                          <b>{fmt(r.value)}</b>
                        </div>
                      ))}
                  </dl>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
