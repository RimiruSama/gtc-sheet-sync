import ExcelJS from "exceljs";

type ExportRow = Record<string, unknown>;

function normalizeText(input: unknown) {
  return String(input ?? "").trim();
}

function normalizeNumber(input: unknown) {
  const n = typeof input === "number" ? input : Number(input);
  return Number.isFinite(n) ? n : null;
}

function getWeeklyTransactionVolumeRaw(obj: ExportRow) {
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

function toSafeObject(row: unknown): ExportRow {
  return row && typeof row === "object" ? (row as ExportRow) : {};
}

export async function exportRowsToXlsx(filePath: string, rows: unknown[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MyGTC Commission Sheet Sync";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Report", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "#", key: "idx", width: 6 },
    { header: "Email", key: "email", width: 32 },
    { header: "Full name", key: "fullName", width: 28 },
    { header: "Total deposits", key: "totalDeposits", width: 16 },
    { header: "Total withdrawals", key: "totalWithdrawals", width: 18 },
    { header: "Balance", key: "remainingBalance", width: 14 },
    { header: "Weekly transaction volume", key: "weeklyTransactionVolume", width: 26 },
  ];

  const safeRows = Array.isArray(rows) ? rows : [];
  safeRows.forEach((row, i) => {
    const obj = toSafeObject(row);
    const email = normalizeText(obj.email ?? obj.mail);
    const fullName = normalizeText(
      obj.realname ?? obj.realName ?? obj.fullName ?? obj.full_name ?? obj.name ?? obj.nickname,
    );

    const totalDepositsRaw =
      obj.totalDeposits ?? obj.total_deposits ?? obj.deposits ?? obj.deposit_amount ?? obj.depositAmount;
    const totalWithdrawalsRaw =
      obj.totalWithdrawals ??
      obj.total_withdrawals ??
      obj.withdrawals ??
      obj.withdraw_amount ??
      obj.withdrawAmount;
    const remainingBalanceRaw = obj.remainingBalance ?? obj.remaining_balance ?? obj.balance;
    const weeklyVolumeRaw = getWeeklyTransactionVolumeRaw(obj);

    sheet.addRow({
      idx: i + 1,
      email,
      fullName,
      totalDeposits: normalizeNumber(totalDepositsRaw),
      totalWithdrawals: normalizeNumber(totalWithdrawalsRaw),
      remainingBalance: normalizeNumber(remainingBalanceRaw),
      weeklyTransactionVolume: normalizeNumber(weeklyVolumeRaw) ?? normalizeText(weeklyVolumeRaw),
    });
  });

  sheet.getRow(1).font = { bold: true };

  const numberColumns = ["totalDeposits", "totalWithdrawals", "remainingBalance", "weeklyTransactionVolume"];
  for (const key of numberColumns) {
    const col = sheet.getColumn(key);
    col.numFmt = "#,##0.00";
    col.alignment = { horizontal: "right" };
  }

  sheet.getColumn("idx").alignment = { horizontal: "center" };
  sheet.getColumn("email").alignment = { horizontal: "left" };
  sheet.getColumn("fullName").alignment = { horizontal: "left" };

  await workbook.xlsx.writeFile(filePath);
}
