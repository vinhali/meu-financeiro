import { useState } from 'react';
import { controllableInTotal, coveredByCard, fmt, MonthlyCalc, settled } from '../calc';
import { Budget, BudgetMonth, LineItem, Section } from '../types';
import Cell from './Cell';
import '../budget.css';

const dayLabel = (key: string) => `${key.slice(8, 10)}/${key.slice(5, 7)}`;
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

// Etiqueta curta: uma linha, corta com reticências e mostra o texto inteiro ao passar o mouse.
function Tag({ tone, title, children }: { tone?: 'ok' | 'warn' | 'high' | 'info'; title?: string; children: React.ReactNode }) {
  return (
    <span className={`tag${tone ? ` ${tone}` : ''}`} title={title ?? (typeof children === 'string' ? children : undefined)}>
      {children}
    </span>
  );
}

// O que os bancos dizem sobre aquela célula: uma linha de etiquetas; o detalhe fica na dica do mouse.
function Hint({
  type,
  m,
  value,
  onUse,
  onMark,
  simLeft = 0,
  onSimulate,
}: {
  type: Budget['rows'][number]['type'];
  m: BudgetMonth;
  value: number;
  onUse: (v: number) => void;
  onMark?: (paid: boolean) => void;
  // Simulação das previsões: segundos restantes (0 = desligada) e o botão que liga/desliga.
  simLeft?: number;
  onSimulate?: () => void;
}) {
  if (type === 'limit') return null; // linha controlável tem célula própria (ControlCell)
  if (type === 'fixed') {
    // Marcar como pago à mão: só em mês que já começou e para conta ainda não reconhecida.
    const markButton =
      onMark && m.month && m.state !== 'future' && value > 0 ? (
        <button
          type="button"
          className="tag-btn quiet"
          onClick={() => onMark(true)}
          title="Marca esta conta como paga agora. Amanhã, quando os bancos forem lidos de novo, a marcação é conferida: se nenhum banco mostrar um pagamento desse valor, ela é desfeita."
        >
          marcar pago
        </button>
      ) : null;
    if (m.paid?.manual === 'pending') {
      return (
        <div className="tags">
          <Tag tone="info" title={`Marcado por você em ${dayLabel(m.paid.date)}. Na leitura dos bancos de amanhã a marcação é conferida: se nenhum banco mostrar o pagamento, ela é desfeita.`}>
            ✓ pago · a confirmar
          </Tag>
          {onMark && (
            <button type="button" className="tag-btn quiet" onClick={() => onMark(false)} title="Desfaz a marcação">
              desfazer
            </button>
          )}
        </div>
      );
    }
    // Valor bem diferente do planejado fica só na seção "Planejado × realizado", com o aviso.
    if (!m.paid && m.previous) {
      const when = m.previous.firstDate && m.previous.firstDate !== m.previous.date ? `${dayLabel(m.previous.firstDate)} a ${dayLabel(m.previous.date)}` : dayLabel(m.previous.date);
      const count = (m.previous.count ?? 1) > 1 ? ` em ${m.previous.count} lançamentos` : '';
      return (
        <div className="tags">
          <Tag title={`O débito deste mês ainda não veio. No mês passado foi pago em ${when}: ${fmt(m.previous.amount)}${count}.`}>mês passado · {when}</Tag>
          {value === 0 && (
            <button type="button" className="tag-btn" onClick={() => onUse(m.previous!.amount)} title={`Preencher o previsto deste mês com ${fmt(m.previous.amount)}, o valor pago no mês passado`}>
              usar
            </button>
          )}
          {markButton}
        </div>
      );
    }
    if (!m.paid || m.paid.differs) return markButton ? <div className="tags">{markButton}</div> : null;
    const where = m.paid.onCard ? 'Lançado no cartão' : 'Pago';
    const confirmed = m.paid.manual === 'confirmed' ? ' Você marcou como pago e o banco confirmou.' : '';
    const detail = `${where} em ${dayLabel(m.paid.date)}: ${fmt(m.paid.amount)}${m.paid.count > 1 ? ` (${m.paid.count} cobranças iguais)` : ''} · ${m.paid.name} · ${m.paid.source}`;
    return (
      <div className="tags">
        <Tag tone="ok" title={detail + confirmed}>
          ✓ {m.paid.onCard ? 'no cartão' : 'pago'} {dayLabel(m.paid.date)}
        </Tag>
        {m.paid.manual === 'confirmed' && onMark && (
          <button type="button" className="tag-btn quiet" onClick={() => onMark(false)} title="Desfaz a sua marcação">
            desfazer
          </button>
        )}
        {m.paid.joint && <Tag title={`Numa transferência só de ${fmt(m.paid.joint.total)}, junto com ${m.paid.joint.with.join(' e ')}.`}>junto</Tag>}
        {m.paid.byAmount && <Tag title="Reconhecida só pelo valor, igual ao da fatura anterior: o banco ainda não informou o nome do estabelecimento. Por segurança continua somando no total até o nome chegar.">pelo valor</Tag>}
        {coveredByCard(m.paid) && value > 0 && <Tag title="Já está dentro da fatura do cartão deste mês: não soma de novo no total.">fora do total</Tag>}
        {m.paid.onCard && m.paid.billRow === false && <Tag tone="warn" title="Lançado num cartão que não tem linha de fatura na planilha: continua somando no total. Crie a linha de fatura desse cartão para o valor entrar por ela.">sem linha de fatura</Tag>}
        {m.paid.ahead && value > 0 && <Tag title="Já pago com o adiantamento do dia 20: sai do total do mês junto com ele.">fora do total</Tag>}
      </div>
    );
  }
  if (type === 'income') {
    return m.received ? (
      <div className="tags">
        <Tag tone="ok" title={`Recebido em ${dayLabel(m.received.date)}: ${fmt(m.received.amount)} · ${m.received.name}`}>
          ✓ recebido {dayLabel(m.received.date)}
        </Tag>
      </div>
    ) : null;
  }
  // Fatura de cartão: mostra o valor do banco e oferece usá-lo quando difere do digitado.
  if (m.suggested === null || m.suggested === undefined) return null;
  const label = m.billState === 'closed' ? (m.suggested === 0 ? 'fechou zerada' : 'fatura fechada') : m.billState === 'open' ? 'fatura aberta' : m.forecast ? 'previsão' : 'parcelas contratadas';
  // Como a previsão foi montada, para a dica do mouse.
  const how = m.forecast
    ? `Previsão de ${fmt(m.forecast.total)}: ${fmt(m.forecast.installments)} de parcelas já contratadas + ${fmt(m.forecast.typical)} de compras avulsas (mediana das últimas ${m.forecast.cycles} faturas deste banco, que variaram de ${fmt(m.forecast.low)} a ${fmt(m.forecast.high)}). Não inclui os gastos controláveis nem as assinaturas, que têm linha própria${(m.forecast.events ?? 0) > 0 ? `, nem viagens e transferências pagas no cartão (${fmt(m.forecast.events ?? 0)} nessas faturas): se houver outra, some à parte` : ''}.`
    : null;
  // Depois do vencimento a fatura continua sendo o custo do mês; só muda o tempo do verbo.
  const due = m.dueDate ? ` · ${m.dueDate < new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) ? 'venceu' : 'vence'} ${dayLabel(m.dueDate)}` : '';
  // Previsão de fatura futura: em vez de trocar o valor digitado, simula-se por alguns segundos.
  if (m.forecast && !near(m.suggested, value)) {
    return (
      <div className="tags">
        <Tag tone={simLeft > 0 ? 'info' : 'warn'} title={`${how} No total do mês vale o que está digitado; a simulação mostra como ficaria com a previsão, sem gravar nada.`}>
          {simLeft > 0 ? `simulando · ${simLeft}s` : `previsão ${fmt(m.suggested)}`}
        </Tag>
        {onSimulate && (
          <button type="button" className="tag-btn" onClick={onSimulate} title="Mostra por 30 segundos os valores previstos no lugar dos digitados, para ver o subtotal de cada mês. Nada é gravado.">
            {simLeft > 0 ? 'parar' : 'simular'}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="tags">
      {near(m.suggested, value) ? (
        <Tag tone={m.billState === 'closed' ? 'ok' : 'info'} title={how ?? `Valor do banco: ${fmt(m.suggested)}${due}`}>
          ✓ {label}
          {due}
        </Tag>
      ) : (
        <>
          <Tag tone="warn" title={`O banco mostra ${fmt(m.suggested)} (${label})${due}; a planilha tem outro valor.${m.billState === 'projected' ? '' : ' No total do mês vale o valor do banco.'}`}>
            {label}
            {m.suggested !== 0 && ` ${fmt(m.suggested)}`}
          </Tag>
          <button type="button" className="tag-btn" onClick={() => onUse(m.suggested!)} title="Preencher com o valor do banco">
            usar
          </button>
        </>
      )}
    </div>
  );
}

interface Props {
  items: LineItem[];
  monthly: MonthlyCalc;
  months: string[];
  onChangeValue: (itemId: string, monthIdx: number, value: number) => void;
  onChangeMeta: (itemId: string, patch: Partial<Pick<LineItem, 'name' | 'obs' | 'controllable'>>) => void;
  onAddItem: (section: Section) => void;
  onDeleteItem: (itemId: string) => void;
  onReorder: (section: Section, draggedId: string, targetId: string) => void;
  onRenameMonth: (monthIdx: number, value: string) => void;
  onAddMonth: () => void;
  onRemoveMonth: (monthIdx: number) => void;
  // Marca (ou desmarca) uma conta como paga num mês ("AAAA-MM").
  onMarkPaid?: (itemId: string, month: string, paid: boolean) => void;
  // Simulação das previsões de fatura: segundos restantes e o botão que liga/desliga.
  simLeft?: number;
  onSimulate?: () => void;
  budget?: Budget | null;
}

// Célula de gasto controlável: gasto real do ciclo (vem dos bancos) ao lado do limite editável,
// a barra de uso e duas etiquetas — quanto falta ou passou, e quanto entra no total do mês.
function ControlCell({ m, value, onChange }: { m: BudgetMonth | undefined; value: number; onChange: (v: number) => void }) {
  const started = m && (m.state === 'current' || m.state === 'past') && m.actual !== undefined;
  if (!started) {
    return (
      <div className="pc">
        <div className="pc-top">
          <span>limite</span>
          <Cell value={value} onChange={onChange} />
        </div>
        {m && m.state === 'future' && (
          <div className="tags">
            <Tag title="O ciclo dos cartões desta coluna ainda não começou: não há gasto para mostrar.">ciclo não começou</Tag>
          </div>
        )}
      </div>
    );
  }
  const spent = m.actual ?? 0;
  const used = value > 0 ? spent / value : null;
  const over = value > 0 && spent > value;
  const level = used === null ? undefined : over ? 'high' : m.status === 'near' ? 'warn' : 'ok';
  const inTotal = controllableInTotal(value, m);
  const outside = (m.offBill ?? 0) + (m.accountInMonth ?? 0);
  return (
    <div className="pc">
      <div className="pc-top">
        <b title="Gasto real neste ciclo, pelos bancos (cartões e contas)">{fmt(spent)}</b>
        <span>de</span>
        <Cell value={value} onChange={onChange} />
      </div>
      {used !== null && (
        <div className={`pc-bar ${level}`} role="img" aria-label={`${Math.round(used * 100)}% do limite usado`}>
          <i style={{ width: `${Math.min(used * 100, 100)}%` }} />
        </div>
      )}
      <div className="tags">
        <Tag tone={level} title={used === null ? 'Defina um limite para acompanhar o uso.' : `${Math.round(used * 100)}% do limite usado: ${fmt(spent)} de ${fmt(value)}.`}>
          {used === null ? 'defina um limite' : over ? `${Math.round(used * 100)}% · passou ${fmt(spent - value)}` : `${Math.round(used * 100)}% · restam ${fmt(value - spent)}`}
        </Tag>
        <Tag
          title={`No total do mês entram ${fmt(inTotal)}. ${m.state === 'past' ? 'O ciclo encerrou: o que foi para o cartão já está na fatura.' : 'O que falta gastar do limite; o que foi para o cartão já está nas faturas.'}${outside > 0 ? ` Inclui ${fmt(outside)} que não estão em fatura: ${fmt(m.accountInMonth ?? 0)} saíram da conta neste mês${(m.offBill ?? 0) > 0 ? ` e ${fmt(m.offBill ?? 0)} são de cartão sem linha de fatura` : ''}.` : ''}`}
        >
          no total {fmt(inTotal)}
        </Tag>
      </div>
    </div>
  );
}

function Row({
  item,
  onChangeValue,
  onChangeMeta,
  onDeleteItem,
  onReorder,
  draggedId,
  setDraggedId,
  hints,
  onMarkPaid,
  simLeft = 0,
  onSimulate,
}: {
  item: LineItem;
  hints?: Budget['rows'][number];
  onMarkPaid?: Props['onMarkPaid'];
  simLeft?: number;
  onSimulate?: () => void;
  onChangeValue: Props['onChangeValue'];
  onChangeMeta: Props['onChangeMeta'];
  onDeleteItem: Props['onDeleteItem'];
  onReorder: Props['onReorder'];
  draggedId: string | null;
  setDraggedId: (id: string | null) => void;
}) {
  const [editingObs, setEditingObs] = useState(false);
  return (
    <tr
      className={draggedId === item.id ? 'dragging' : ''}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (draggedId && draggedId !== item.id) onReorder(item.section, draggedId, item.id);
        setDraggedId(null);
      }}
    >
      <td className="cat">
        <div className="cat-row">
          <span
            className="drag-handle"
            title="Arrastar para reordenar"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              setDraggedId(item.id);
            }}
            onDragEnd={() => setDraggedId(null)}
          >
            ⠿
          </span>
          <input
            className="cat-name"
            value={item.name}
            onChange={(e) => onChangeMeta(item.id, { name: e.target.value })}
          />
          <button className="cat-del" title="Remover categoria" aria-label={`Remover ${item.name}`} onClick={() => onDeleteItem(item.id)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
          </button>
        </div>
        <div className="cat-meta">
          {editingObs ? (
            <input
              className="cat-obs"
              autoFocus
              placeholder="escreva a observação"
              value={item.obs}
              onChange={(e) => onChangeMeta(item.id, { obs: e.target.value })}
              onBlur={() => setEditingObs(false)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && e.currentTarget.blur()}
            />
          ) : item.obs ? (
            <button type="button" className="tag" title={`${item.obs} (clique para editar)`} onClick={() => setEditingObs(true)}>
              {item.obs}
            </button>
          ) : (
            <button type="button" className="cat-ctl" onClick={() => setEditingObs(true)}>
              + observação
            </button>
          )}
          {item.section === 'saida' && (
            <button
              type="button"
              className={item.controllable ? 'tag ok' : 'cat-ctl'}
              aria-pressed={item.controllable}
              title={
                item.controllable
                  ? `Gasto controlável${hints?.rule ? `: conta ${hints.rule.toLowerCase()}` : ''}. Clique para desmarcar.`
                  : 'Gasto controlável: o valor do mês vira um limite e a célula mostra quanto já foi gasto, pelos bancos'
              }
              onClick={() => onChangeMeta(item.id, { controllable: !item.controllable })}
            >
              {item.controllable ? '✓ controlável' : '+ gasto controlável'}
            </button>
          )}
        </div>
      </td>
      {item.values.map((v, mi) => (
        <td className="num" key={mi}>
          {item.controllable ? (
            <ControlCell m={hints?.type === 'limit' ? hints.months[mi] : undefined} value={v} onChange={(val) => onChangeValue(item.id, mi, val)} />
          ) : (
            <>
              {simLeft > 0 && hints?.type === 'cardBill' && hints.months[mi]?.billState === 'projected' && hints.months[mi]?.forecast ? (
                // Simulação: o valor previsto aparece no lugar do digitado, sem poder editar.
                <div className="sim" title={`Digitado: ${fmt(v)}`}>
                  {fmt(hints.months[mi].forecast!.total)}
                </div>
              ) : (
                <div className={hints?.type === 'fixed' && settled(hints.months[mi]?.paid) && v > 0 ? 'covered' : undefined}>
                  <Cell value={v} onChange={(val) => onChangeValue(item.id, mi, val)} />
                </div>
              )}
              {hints?.months[mi] && (
                <Hint
                  type={hints.type}
                  m={hints.months[mi]}
                  value={v}
                  onUse={(val) => onChangeValue(item.id, mi, val)}
                  onMark={onMarkPaid && hints.months[mi].month ? (paid) => onMarkPaid(item.id, hints.months[mi].month!, paid) : undefined}
                  simLeft={simLeft}
                  onSimulate={onSimulate}
                />
              )}
            </>
          )}
        </td>
      ))}
    </tr>
  );
}

export default function PlanilhaTable({
  items,
  monthly,
  months,
  onChangeValue,
  onChangeMeta,
  onAddItem,
  onDeleteItem,
  onReorder,
  onRenameMonth,
  onAddMonth,
  onRemoveMonth,
  onMarkPaid,
  simLeft = 0,
  onSimulate,
  budget,
}: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // As dicas valem enquanto as colunas da planilha são as mesmas do último cálculo.
  const hintsOk = budget && budget.months.length === months.length && budget.months.every((m, i) => m.label === months[i]);
  const hintsOf = (id: string) => (hintsOk ? budget!.rows.find((r) => r.itemId === id) : undefined);
  // Faturas em que o valor do banco (ou a previsão, nos meses futuros) difere do digitado, para
  // preencher todas de uma vez. "Parcelas contratadas" sem previsão é só um piso: não entra.
  const billDiffs = hintsOk
    ? items.flatMap((item) => {
        const row = budget!.rows.find((r) => r.itemId === item.id && r.type === 'cardBill');
        return row
          ? row.months.flatMap((m, mi) =>
              m.suggested !== null && m.suggested !== undefined && (m.billState !== 'projected' || m.forecast) && !near(m.suggested, item.values[mi] ?? 0)
                ? [{ id: item.id, mi, value: m.suggested, forecast: m.billState === 'projected' }]
                : [],
            )
          : [];
      })
    : [];
  const billFixes = billDiffs.filter((f) => !f.forecast);
  const forecastFixes = billDiffs.filter((f) => f.forecast);
  const entradas = items.filter((i) => i.section === 'entrada');
  const saidas = items.filter((i) => i.section === 'saida');
  const colSpan = months.length + 1;

  return (
    <div className="grid-wrap">
      {billFixes.length > 0 && (
        <div className="ph-toolbar">
          <span>{billFixes.length} fatura(s) de cartão com valor diferente do que o banco informa.</span>
          <button type="button" onClick={() => billFixes.forEach((f) => onChangeValue(f.id, f.mi, f.value))}>
            preencher com os valores do banco
          </button>
        </div>
      )}
      {forecastFixes.length > 0 && (
        <div className={simLeft > 0 ? 'ph-toolbar sim-on' : 'ph-toolbar'}>
          <span>
            {simLeft > 0
              ? `Simulando por mais ${simLeft}s: as faturas futuras estão com o valor previsto. Veja o subtotal e o saldo de cada mês; nada é gravado.`
              : `${forecastFixes.length} fatura(s) futura(s) com previsão diferente do digitado. Simule para ver como ficaria o mês se o gasto no cartão seguir o padrão das últimas faturas.`}
          </span>
          {onSimulate && (
            <button type="button" onClick={onSimulate}>
              {simLeft > 0 ? 'parar a simulação' : 'simular por 30 s'}
            </button>
          )}
        </div>
      )}
      <table>
        <thead>
          <tr>
            <th className="cat">Categorias</th>
            {months.map((m, mi) => (
              <th key={mi}>
                <div className="month-head">
                  <div className="month-label-row">
                    <input className="month-name" value={m} onChange={(e) => onRenameMonth(mi, e.target.value)} />
                    <div className="month-actions">
                      {mi === months.length - 1 && (
                        <button className="month-add" onClick={onAddMonth} title="Adicionar mês copiando os valores do anterior">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                          mês
                        </button>
                      )}
                      {months.length > 1 && (
                        <button className="month-del" onClick={() => onRemoveMonth(mi)} title={`Tirar ${m} da planilha (os valores vão para o histórico)`} aria-label={`Tirar ${m} da planilha`}>
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="grp">
            <td colSpan={colSpan}>▼ Entradas</td>
          </tr>
          {entradas.map((item) => (
            <Row
              key={item.id}
              item={item}
              onChangeValue={onChangeValue}
              onChangeMeta={onChangeMeta}
              onDeleteItem={onDeleteItem}
              onReorder={onReorder}
              draggedId={draggedId}
              setDraggedId={setDraggedId}
              hints={hintsOf(item.id)}
              onMarkPaid={onMarkPaid}
              simLeft={simLeft}
              onSimulate={onSimulate}
            />
          ))}
          <tr className="add-row">
            <td colSpan={colSpan}>
              <button className="add-cat" onClick={() => onAddItem('entrada')}>
                + adicionar categoria de entrada
              </button>
            </td>
          </tr>
          <tr className="total entr">
            <td className="cat">Entradas Totais</td>
            {monthly.entradasTotais.map((v, i) => (
              <td key={i}>{fmt(v)}</td>
            ))}
          </tr>

          <tr className="grp">
            <td colSpan={colSpan}>▼ Débitos</td>
          </tr>
          {saidas.map((item) => (
            <Row
              key={item.id}
              item={item}
              onChangeValue={onChangeValue}
              onChangeMeta={onChangeMeta}
              onDeleteItem={onDeleteItem}
              onReorder={onReorder}
              draggedId={draggedId}
              setDraggedId={setDraggedId}
              hints={hintsOf(item.id)}
              onMarkPaid={onMarkPaid}
              simLeft={simLeft}
              onSimulate={onSimulate}
            />
          ))}
          <tr className="add-row">
            <td colSpan={colSpan}>
              <button className="add-cat" onClick={() => onAddItem('saida')}>
                + adicionar categoria de débito
              </button>
            </td>
          </tr>
          <tr className="total gasto">
            <td className="cat">Gastos Totais</td>
            {monthly.saidasTotais.map((v, i) => (
              <td key={i}>{fmt(v)}</td>
            ))}
          </tr>

          <tr className="sub">
            <td className="cat">SubTotal do mês</td>
            {monthly.subtotal.map((v, i) => (
              <td key={i} className={v >= 0 ? 'pos' : 'neg'}>
                {fmt(v)}
              </td>
            ))}
          </tr>

          <tr className="acum">
            <td className="cat">SALDO ACUMULADO</td>
            {monthly.acumulado.map((v, i) => (
              <td key={i} className={v >= 0 ? 'pos' : 'neg'}>
                {fmt(v)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
