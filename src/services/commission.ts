import axios from "axios";

type AnyRow = Record<string, unknown>;

type EnrichOptions = {
  token: string;
  rows: unknown[];
  concurrency?: number;
  timeoutMs?: number;
  tradeStartEpochSec: number;
  tradeEndEpochSec: number;
};

function toSafeObject(row: unknown): AnyRow {
  return row && typeof row === "object" ? (row as AnyRow) : {};
}

function normalizeText(input: unknown) {
  return String(input ?? "").trim();
}

function getEmailFromRow(row: AnyRow) {
  return normalizeText(row.email ?? row.mail);
}

function getWeeklyTransactionVolumeRaw(obj: AnyRow) {
  return (
    obj.weeklyTransactionVolume ??
    obj.weekly_transaction_volume ??
    obj.weeklyVolume ??
    obj.commission_all ??
    obj.commissionAll ??
    (obj.commission_amount &&
    typeof obj.commission_amount === "object" &&
    obj.commission_amount
      ? (obj.commission_amount as Record<string, unknown>).commission_all
      : "") ??
    ""
  );
}

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
) {
  const safeLimit = Math.max(1, Math.trunc(limit || 1));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from(
    { length: Math.min(safeLimit, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function fetchCommissionRowByKeyword(args: {
  token: string;
  keyword: string;
  tradeStartEpochSec: number;
  tradeEndEpochSec: number;
  timeoutMs: number;
}) {
  const payload = {
    keyword: args.keyword,
    trade_start: args.tradeStartEpochSec,
    trade_end: args.tradeEndEpochSec,
    page: 1,
    page_size: 1,
  };

  const response = await axios.post(
    "https://web.mygtc.app/api/agent/commission_ib_list",
    payload,
    {
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        authorization: `Bearer ${args.token}`,
        "x-app-lang": "vn",
      },
      timeout: args.timeoutMs,
      maxRedirects: 0,
      validateStatus: () => true,
    },
  );

  if (response.status !== 200) return null;
  const data = response.data as any;
  const maybeList =
    data?.data?.list ??
    data?.data?.rows ??
    data?.data?.items ??
    data?.list ??
    data?.rows ??
    data?.items ??
    data?.result ??
    data;

  const rows = Array.isArray(maybeList) ? maybeList : [];
  const first = rows[0];
  return first && typeof first === "object" ? (first as AnyRow) : null;
}

export async function enrichRowsWithWeeklyTransactionVolume(options: EnrichOptions) {
  const token = normalizeText(options.token);
  const inputRows = Array.isArray(options.rows) ? options.rows : [];
  const timeoutMs = Math.max(1_000, Math.trunc(options.timeoutMs ?? 15_000));
  const concurrency = Math.max(1, Math.trunc(options.concurrency ?? 3));

  if (!token || inputRows.length === 0) return inputRows;

  const cacheByEmail = new Map<string, unknown>();

  const tasks = inputRows
    .map((r, index) => ({ index, obj: toSafeObject(r) }))
    .map((t) => ({ ...t, email: getEmailFromRow(t.obj) }))
    .filter((t) => Boolean(t.email));

  if (tasks.length === 0) return inputRows;

  await runWithConcurrencyLimit(tasks, concurrency, async (t) => {
    if (cacheByEmail.has(t.email)) return;
    try {
      const commissionRow = await fetchCommissionRowByKeyword({
        token,
        keyword: t.email,
        tradeStartEpochSec: options.tradeStartEpochSec,
        tradeEndEpochSec: options.tradeEndEpochSec,
        timeoutMs,
      });
      const weeklyRaw = commissionRow ? getWeeklyTransactionVolumeRaw(commissionRow) : "";
      cacheByEmail.set(t.email, weeklyRaw == null ? "" : weeklyRaw);
    } catch {
      cacheByEmail.set(t.email, "");
    }
  });

  return inputRows.map((r) => {
    const obj = toSafeObject(r);
    const email = getEmailFromRow(obj);
    if (!email) return r;
    const weekly = cacheByEmail.get(email);
    return { ...obj, weeklyTransactionVolume: weekly };
  });
}

