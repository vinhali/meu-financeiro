import { fmt, MonthlyCalc, PlanStatus } from '../calc';
import Cell from './Cell';

const STATUS_LABEL: Record<PlanStatus, string> = {
  seguro: 'Seguro',
  atencao: 'Atenção',
  critico: 'Crítico',
};

export default function DashboardCards({
  monthly,
  planStatus,
  emergencyReserve,
  onChangeEmergencyReserve,
}: {
  monthly: MonthlyCalc;
  planStatus: PlanStatus;
  emergencyReserve: number;
  onChangeEmergencyReserve: (value: number) => void;
}) {
  return (
    <section>
      <h2>Visão geral</h2>
      <div className="kpis">
        <div className="kpi">
          <div className="lbl">Saldo acumulado final</div>
          <div className={`val ${monthly.acumulado[monthly.acumulado.length - 1] >= 0 ? 'green' : 'red'}`}>
            {fmt(monthly.acumulado[monthly.acumulado.length - 1])}
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Déficit financeiro total</div>
          <div className={`val ${monthly.deficitTotal > 0 ? 'red' : 'green'}`}>{fmt(monthly.deficitTotal)}</div>
          <div className="note">somado em {monthly.negativeMonths.length} mês(es)</div>
        </div>
        <div className="kpi">
          <div className="lbl">Reserva de emergência</div>
          <div className="val green reserve-input">
            R$ <Cell value={emergencyReserve} onChange={onChangeEmergencyReserve} />
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Saldo extra até o último mês</div>
          <div className={`val ${monthly.rendaExtraNecessaria > 0 ? 'amber' : 'green'}`}>
            {monthly.rendaExtraNecessaria > 0 ? fmt(monthly.rendaExtraNecessaria) : 'Fechado'}
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Saúde financeira</div>
          <div className="val">
            <span className={`status-pill ${planStatus}`}>{STATUS_LABEL[planStatus]}</span>
          </div>
        </div>
      </div>

      {monthly.negativeMonths.length > 0 && (
        <div className="alert-box">
          <b>Meses com saldo acumulado negativo:</b> {monthly.negativeMonths.join(', ')}.
        </div>
      )}
    </section>
  );
}
