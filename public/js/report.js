import {
  buildIndex, computeStats, levelOf, directionOf, accountTotals, fmtMoney, fmtDate,
  fmtNum, operationLabel, recentRegistrations
} from './model.js';

const sponsorName = (p, byId) => {
  if (p.sponsor == null) return '—';
  return byId.get(p.sponsor)?.name || '—';
};

function sortedPartners(state, idx) {
  return [...state.partners].sort((a, b) => {
    const la = levelOf(a.id, state.settings.ownerId, idx) ?? 0;
    const lb = levelOf(b.id, state.settings.ownerId, idx) ?? 0;
    return la - lb || a.id - b.id;
  });
}

export function buildReportSheets(state) {
  const idx = buildIndex(state.partners);
  const owner = idx.byId.get(state.settings.ownerId);
  const root = computeStats(state.settings.ownerId, idx);
  const total = accountTotals(state.operations);
  const partners = sortedPartners(state, idx);

  const partnerRows = partners.map((p, i) => {
    const st = computeStats(p.id, idx);
    return {
      n: i + 1,
      id: p.id,
      name: p.name,
      dir: directionOf(p.id, state.settings.ownerId, idx) || '—',
      level: levelOf(p.id, state.settings.ownerId, idx) ?? 0,
      sponsor: sponsorName(p, idx.byId),
      since: fmtDate(p.since),
      phone: p.phone || '',
      email: p.email || '',
      status: p.status || '',
      volume: Number(p.volume) || 0,
      points: Math.round((Number(p.volume) || 0) / 100),
      branchVolume: st.volume - st.personal.volume,
      branchCount: st.partnersBelow,
      sets: Number(p.sets) || 0
    };
  });

  const structureRows = [];
  (function walk(id, depth) {
    const p = idx.byId.get(id);
    if (!p) return;
    const st = computeStats(id, idx);
    structureRows.push({
      level: depth,
      name: p.name,
      id: p.id,
      sponsor: sponsorName(p, idx.byId),
      dir: p.dir || '—',
      volume: st.volume,
      count: st.partnersBelow,
      sets: st.sets
    });
    for (const d of ['A', 'B', 'C']) {
      const cid = idx.children.get(id)[d];
      if (cid) walk(cid, depth + 1);
    }
  })(state.settings.ownerId, 0);

  const dirRows = ['A', 'B', 'C'].map((d) => ({
    label: `Направление ${d}`,
    count: root.byDir[d].count,
    volume: root.byDir[d].volume,
    points: root.byDir[d].points,
    sets: root.byDir[d].sets
  }));

  const summary = [
    { label: 'Дата выгрузки', value: fmtDate(new Date().toISOString().slice(0, 10)), note: '' },
    { label: 'Владелец структуры', value: owner?.name || '—', note: `ID ${owner?.id ?? ''}` },
    { label: 'Всего партнёров', value: fmtNum(root.partnersBelow), note: 'без владельца' },
    { label: 'Наборов в структуре', value: fmtNum(root.sets), note: '' },
    { label: 'Оборот структуры', value: fmtMoney(root.volume), note: 'личный + ветки' },
    { label: 'Баллы структуры', value: fmtNum(root.points), note: '1 балл = 100 ₽' },
    { label: 'Новых за 30 дней', value: fmtNum(recentRegistrations(state.partners).length), note: '' },
    ...dirRows.map((r) => ({
      label: r.label,
      value: `${fmtNum(r.count)} чел. · ${fmtMoney(r.volume)}`,
      note: `${fmtNum(r.points)} баллов · ${fmtNum(r.sets)} наборов`
    })),
    { label: 'Личный объём', value: fmtMoney(root.personal.volume), note: `${fmtNum(root.personal.points)} баллов` },
    { label: 'Начислено всего', value: fmtMoney(total.accrued), note: '' },
    { label: 'Выплачено', value: fmtMoney(total.paid), note: '' },
    { label: 'В обработке', value: fmtMoney(total.pending), note: 'заявки на вывод' },
    { label: 'Переводы партнёрам', value: fmtMoney(total.transfersOut), note: '' },
    { label: 'Доступно к выводу', value: fmtMoney(total.available), note: '' }
  ];

  const operationRows = [...state.operations]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .map((op) => ({
      date: fmtDate(op.date),
      type: operationLabel(op),
      partner: op.partnerId ? idx.byId.get(op.partnerId)?.name || '' : '',
      amount: Number(op.amount) || 0,
      status: op.status === 'pending' ? 'В обработке' : 'Выполнено',
      comment: op.comment || ''
    }));

  return [
    {
      name: 'Партнёры',
      columns: [
        { header: '№', key: 'n', width: 5, type: 'int' },
        { header: 'ID', key: 'id', width: 9, type: 'int' },
        { header: 'ФИО', key: 'name', width: 26 },
        { header: 'Направление', key: 'dir', width: 12 },
        { header: 'Уровень', key: 'level', width: 9, type: 'int' },
        { header: 'Спонсор', key: 'sponsor', width: 26 },
        { header: 'Регистрация', key: 'since', width: 12 },
        { header: 'Телефон', key: 'phone', width: 19 },
        { header: 'E-mail', key: 'email', width: 30 },
        { header: 'Статус', key: 'status', width: 11 },
        { header: 'Личный объём, ₽', key: 'volume', width: 17, type: 'money' },
        { header: 'Баллы', key: 'points', width: 9, type: 'int' },
        { header: 'Оборот ветки, ₽', key: 'branchVolume', width: 17, type: 'money' },
        { header: 'Партнёров', key: 'branchCount', width: 11, type: 'int' },
        { header: 'Наборов', key: 'sets', width: 9, type: 'int' }
      ],
      rows: partnerRows
    },
    {
      name: 'Структура',
      columns: [
        { header: 'Уровень', key: 'level', width: 9, type: 'int' },
        { header: 'Партнёр', key: 'name', width: 30 },
        { header: 'ID', key: 'id', width: 9, type: 'int' },
        { header: 'Спонсор', key: 'sponsor', width: 28 },
        { header: 'Направление', key: 'dir', width: 12 },
        { header: 'Оборот ветки, ₽', key: 'volume', width: 18, type: 'money' },
        { header: 'Партнёров в ветке', key: 'count', width: 16, type: 'int' },
        { header: 'Наборов', key: 'sets', width: 9, type: 'int' }
      ],
      rows: structureRows
    },
    {
      name: 'Сводка',
      columns: [
        { header: 'Показатель', key: 'label', width: 26 },
        { header: 'Значение', key: 'value', width: 26 },
        { header: 'Примечание', key: 'note', width: 28 }
      ],
      rows: summary
    },
    {
      name: 'Операции',
      columns: [
        { header: 'Дата', key: 'date', width: 12 },
        { header: 'Тип', key: 'type', width: 20 },
        { header: 'Партнёр', key: 'partner', width: 28 },
        { header: 'Сумма, ₽', key: 'amount', width: 14, type: 'money' },
        { header: 'Статус', key: 'status', width: 14 },
        { header: 'Комментарий', key: 'comment', width: 40 }
      ],
      rows: operationRows
    }
  ];
}
