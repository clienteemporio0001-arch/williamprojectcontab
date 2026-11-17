import type { Client, Obligation } from './types';

export type MonthlyRenewalDraft = {
  client_id: string;
  title: string;
  amount: number;
  due_date: string;
  status: 'pending';
  document_url: null;
  recurring: true;
  series_id: string;
  due_day: number;
  reminder_offsets: number[];
};

export type MonthlyRenewalPlan = {
  month: string;
  candidates: MonthlyRenewalDraft[];
  alreadyCreated: number;
  inactiveClients: number;
  cancelledSeries: number;
  invalidSeries: number;
  futureSeries: number;
};

function dueDateForMonth(month: string, day: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/**
 * Prepara o próximo mês sem modificar registros, PDFs ou pagamentos.
 * Uma série gera no máximo uma cobrança por competência. A confirmação
 * deve consultar o Supabase novamente antes de inserir os registros.
 */
export function buildMonthlyRenewalPlan(
  obligations: readonly Obligation[],
  clients: readonly Pick<Client, 'id' | 'active'>[],
  targetMonth: string
): MonthlyRenewalPlan {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) {
    throw new Error('Mês de cobrança inválido.');
  }

  const activeClients = new Map(clients.map(client => [client.id, client.active]));
  const latestBySeries = new Map<string, Obligation>();
  const existingInMonth = new Set<string>();

  for (const charge of obligations) {
    if (!charge.recurring || !charge.series_id) continue;
    if (charge.due_date.slice(0, 7) === targetMonth) {
      existingInMonth.add(charge.series_id);
    }

    const previous = latestBySeries.get(charge.series_id);
    if (!previous || charge.due_date > previous.due_date) {
      latestBySeries.set(charge.series_id, charge);
    }
  }

  const result: MonthlyRenewalPlan = {
    month: targetMonth,
    candidates: [],
    alreadyCreated: 0,
    inactiveClients: 0,
    cancelledSeries: 0,
    invalidSeries: 0,
    futureSeries: 0
  };

  for (const [seriesId, latest] of latestBySeries) {
    if (existingInMonth.has(seriesId)) {
      result.alreadyCreated++;
      continue;
    }
    // Nunca gerar retroativamente uma competência anterior à última já registrada.
    if (latest.due_date.slice(0, 7) > targetMonth) {
      result.futureSeries++;
      continue;
    }
    if (latest.status === 'cancelled') {
      result.cancelledSeries++;
      continue;
    }
    if (activeClients.get(latest.client_id) !== true) {
      result.inactiveClients++;
      continue;
    }
    if (!Number.isInteger(latest.due_day) || latest.due_day! < 1 || latest.due_day! > 31 ||
        latest.amount === null || !Number.isFinite(latest.amount) || latest.amount < 0) {
      result.invalidSeries++;
      continue;
    }

    result.candidates.push({
      client_id: latest.client_id,
      title: latest.title,
      amount: latest.amount,
      due_date: dueDateForMonth(targetMonth, latest.due_day!),
      status: 'pending',
      document_url: null,
      recurring: true,
      series_id: seriesId,
      due_day: latest.due_day!,
      reminder_offsets: [...(latest.reminder_offsets || [7, 3, 1, 0])]
    });
  }

  result.candidates.sort((a, b) =>
    a.due_date.localeCompare(b.due_date) || a.client_id.localeCompare(b.client_id)
  );
  return result;
}
