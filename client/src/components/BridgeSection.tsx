import { BridgeCalc, fmt } from '../calc';
import { Bridge } from '../types';

interface Props {
  bridge: Bridge;
  bridgeCalc: BridgeCalc;
  bridgeMonths: string[];
  onChange: (bridge: Bridge) => void;
  onRenameBridgeMonth: (monthIdx: number, value: string) => void;
  onAddBridgeMonth: () => void;
  onRemoveLastBridgeMonth: () => void;
}

export default function BridgeSection({
  bridge,
  bridgeCalc,
  bridgeMonths,
  onChange,
  onRenameBridgeMonth,
  onAddBridgeMonth,
  onRemoveLastBridgeMonth,
}: Props) {
  return (
    <section>
      <div className="eyebrow">projeção 2027 · ponte até a plr</div>
      <h2>Ponte até PLR — {bridgeMonths.join(', ')}</h2>
      <div className="note-box">
        <b>Como ler:</b> cada mês da ponte repete as despesas recorrentes do último mês da planilha (exceto as
        marcadas como "fora da ponte") e as receitas mensais recorrentes — com o dissídio aplicado às marcadas como
        "dissídio". O último mês soma a PLR editável. O ponto de partida é o SALDO ACUMULADO do último mês da
        planilha acima.
      </div>

      {bridgeCalc.negativeMonths.length > 0 && (
        <div className="alert-box">
          <b>Atenção:</b> a projeção fica negativa em {bridgeCalc.negativeMonths.join(' e ')}.
        </div>
      )}

      <div className="bridge-grid">
        {bridgeCalc.months.map((m, idx) => {
          const isLast = idx === bridgeCalc.months.length - 1;
          return (
            <div className="bridge-card" key={idx}>
              <input
                className="month-label"
                value={bridgeMonths[idx]}
                onChange={(e) => onRenameBridgeMonth(idx, e.target.value)}
              />
              <div className="bridge-row">
                <span>Entradas recorrentes</span>
                <b className="pos">{fmt(m.entradas)}</b>
              </div>
              <div className="bridge-row">
                <span>Despesas recorrentes (sem "fora da ponte")</span>
                <b className="neg">{fmt(m.saidas)}</b>
              </div>
              {!isLast && (
                <div className="bridge-row total">
                  <span>Saldo estimado</span>
                  <b className={m.saldo >= 0 ? 'pos' : 'neg'}>{fmt(m.saldo)}</b>
                </div>
              )}
              {isLast && (
                <>
                  <div className="bridge-row">
                    <span>Saldo antes da PLR</span>
                    <b className={bridgeCalc.saldoAntesPlr >= 0 ? 'pos' : 'neg'}>{fmt(bridgeCalc.saldoAntesPlr)}</b>
                  </div>
                  <div className="bridge-row total">
                    <span>Saldo depois da PLR</span>
                    <b className={bridgeCalc.saldoDepoisPlr >= 0 ? 'pos' : 'neg'}>{fmt(bridgeCalc.saldoDepoisPlr)}</b>
                  </div>
                  <div className="bridge-field">
                    <label htmlFor="plr">PLR deste mês (R$)</label>
                    <input
                      id="plr"
                      inputMode="decimal"
                      value={bridge.plr === 0 ? '' : String(bridge.plr)}
                      placeholder="0"
                      onChange={(e) => {
                        const n = parseFloat(e.target.value.replace(',', '.'));
                        onChange({ ...bridge, plr: isNaN(n) ? 0 : n });
                      }}
                    />
                  </div>
                  <div className="bridge-field">
                    <label htmlFor="dissidio">Dissídio / reajuste salarial (%)</label>
                    <input
                      id="dissidio"
                      inputMode="decimal"
                      value={bridge.dissidioPercent === 0 ? '' : String(bridge.dissidioPercent)}
                      placeholder="0"
                      onChange={(e) => {
                        const n = parseFloat(e.target.value.replace(',', '.'));
                        onChange({ ...bridge, dissidioPercent: isNaN(n) ? 0 : n });
                      }}
                    />
                  </div>
                </>
              )}
              {isLast && (
                <div className="bridge-card-actions">
                  <button onClick={onAddBridgeMonth} title="Adicionar mês ao final da ponte">
                    + adicionar mês
                  </button>
                  {bridgeMonths.length > 1 && (
                    <button onClick={onRemoveLastBridgeMonth} title="Remover último mês da ponte">
                      ✕ remover último
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="tot-line">
        <span>
          Saldo acumulado no início da ponte: <b>{fmt(bridgeCalc.caixaUltimoMes)}</b>
        </span>
        <b className={bridgeCalc.podePagarAteUltimo ? 'pos' : 'neg'}>
          {bridgeCalc.podePagarAteUltimo
            ? 'O saldo cobre todos os meses da ponte até a PLR ✓'
            : 'O saldo NÃO cobre todos os meses da ponte até a PLR'}
        </b>
      </div>
    </section>
  );
}
