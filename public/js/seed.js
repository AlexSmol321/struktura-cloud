// Демонстрационные данные. Все имена, телефоны и суммы вымышленные.
export const APP_NAME = 'Структура';
export const APP_VERSION = '1.0.0';
export const STATUSES = ['Старт', 'Партнёр', 'Серебро', 'Золото', 'Платина'];
export const DIRECTIONS = ['A', 'B', 'C'];

const partner = (id, name, sponsor, dir, since, phone, email, volume, sets, status) => ({
  id, name, sponsor, dir, since, phone, email, volume, sets, status, note: ''
});

export function createSeed() {
  const partners = [
    partner(100001, 'Волков Дмитрий', null, null, '2025-03-12', '+7 999 111-22-33', 'volkov@example.ru', 84500, 2, 'Золото'),

    partner(100002, 'Иванова Мария', 100001, 'A', '2025-04-02', '+7 928 111-22-33', 'm.ivanova@example.ru', 120000, 3, 'Золото'),
    partner(100003, 'Петрова Анна', 100002, 'A', '2025-06-18', '+7 988 204-51-17', 'a.petrova@example.ru', 74000, 2, 'Серебро'),
    partner(100004, 'Сидорова Елена', 100003, 'A', '2025-09-05', '+7 963 418-77-02', 'e.sidorova@example.ru', 38000, 1, 'Партнёр'),
    partner(100005, 'Кузнецова Ольга', 100004, 'A', '2026-01-22', '+7 928 305-18-64', 'o.kuznetsova@example.ru', 12000, 1, 'Старт'),
    partner(100006, 'Морозов Артём', 100004, 'B', '2025-12-11', '+7 988 741-09-35', 'a.morozov@example.ru', 21000, 1, 'Партнёр'),
    partner(100007, 'Новикова Дарья', 100004, 'C', '2026-03-19', '+7 963 620-44-81', 'd.novikova@example.ru', 9000, 1, 'Старт'),
    partner(100008, 'Соколова Ирина', 100003, 'B', '2026-02-04', '+7 928 517-82-09', 'i.sokolova@example.ru', 16500, 1, 'Старт'),
    partner(100009, 'Лебедев Павел', 100008, 'A', '2026-05-14', '+7 988 633-27-48', 'p.lebedev@example.ru', 27000, 1, 'Партнёр'),
    partner(100010, 'Попов Максим', 100002, 'B', '2025-10-27', '+7 963 802-15-73', 'm.popov@example.ru', 33000, 2, 'Партнёр'),

    partner(100011, 'Егоров Сергей', 100001, 'B', '2025-07-15', '+7 928 460-73-26', 's.egorov@example.ru', 46000, 2, 'Серебро'),
    partner(100012, 'Никитина Наталья', 100011, 'A', '2025-11-08', '+7 988 318-56-90', 'n.nikitina@example.ru', 24000, 1, 'Партнёр'),
    partner(100013, 'Орлова Виктория', 100012, 'A', '2026-04-26', '+7 963 557-31-08', 'v.orlova@example.ru', 11000, 1, 'Старт'),
    partner(100014, 'Зайцев Роман', 100011, 'B', '2026-10-14', '+7 928 690-12-45', 'r.zaytsev@example.ru', 19500, 1, 'Старт'),

    partner(100015, 'Белова Алина', 100001, 'C', '2025-08-21', '+7 988 275-64-39', 'a.belova@example.ru', 52000, 2, 'Серебро'),
    partner(100016, 'Гусева Полина', 100015, 'A', '2026-10-26', '+7 963 744-08-57', 'p.guseva@example.ru', 17500, 1, 'Старт')
  ];

  const operations = [
    { id: 'op-10', date: '2026-11-02', type: 'payout', amount: 12000, status: 'pending', method: 'Карта •• 4417', comment: 'Заявка на вывод' },
    { id: 'op-9', date: '2026-10-31', type: 'accrual', amount: 27150, status: 'done', comment: 'Начисление за оборот структуры — октябрь' },
    { id: 'op-8', date: '2026-10-20', type: 'transfer_out', amount: 3500, status: 'done', partnerId: 100008, comment: 'Оплата набора' },
    { id: 'op-7', date: '2026-10-09', type: 'payout', amount: 15000, status: 'done', method: 'Карта •• 4417', comment: 'Вывод средств' },
    { id: 'op-6', date: '2026-09-30', type: 'accrual', amount: 24800, status: 'done', comment: 'Начисление за оборот структуры — сентябрь' },
    { id: 'op-5', date: '2026-09-15', type: 'accrual', amount: 10000, status: 'done', comment: 'Бонус за статус «Золото»' },
    { id: 'op-4', date: '2026-09-12', type: 'transfer_out', amount: 5000, status: 'done', partnerId: 100002, comment: 'Помощь на рекламу' },
    { id: 'op-3', date: '2026-08-31', type: 'accrual', amount: 21300, status: 'done', comment: 'Начисление за оборот структуры — август' },
    { id: 'op-2', date: '2026-08-05', type: 'payout', amount: 20000, status: 'done', method: 'Карта •• 4417', comment: 'Вывод средств' },
    { id: 'op-1', date: '2026-07-31', type: 'accrual', amount: 18450, status: 'done', comment: 'Начисление за оборот структуры — июль' }
  ];

  return {
    meta: { seed: '2026-11-06', version: 1, createdAt: '2026-11-06T09:00:00+03:00' },
    settings: { ownerId: 100001 },
    partners,
    operations
  };
}
