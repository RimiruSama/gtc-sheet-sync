import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import axios from "axios";
import { exportRowsToXlsx } from "./services/exporter";
import { enrichRowsWithWeeklyTransactionVolume } from "./services/commission";

const API_BASE_URL = "https://web.mygtc.app/api/agent" as const;
const API_ENDPOINTS = {
  IB_REPORT: `${API_BASE_URL}/ib_report`,
  COMMISSION_IB_LIST: `${API_BASE_URL}/commission_ib_list`,
} as const;

const DEFAULT_TIMEOUT_MS = 30_000 as const;

type FetchReportArgs = {
  token?: string;
  params?: {
    keyword?: string;
  };
};

type FetchCommissionArgs = {
  token?: string;
  params?: {
    keyword?: string;
    // Backward compatibility for older renderer/preload versions
    email?: string;
  };
};

function trimString(input: unknown) {
  return typeof input === "string" ? input.trim() : "";
}

function isTokenErrorMessage(message: string) {
  return /(token|unauth|unauthorized|expired|invalid|forbidden)/i.test(message);
}

function toEpochSeconds(date: Date) {
  return Math.floor(date.getTime() / 1000);
}

function getWeekRange(now: Date) {
  const weekStart = startOfWeekMonday(now);
  const weekEnd = endOfWeekSunday(now);
  return { weekStart, weekEnd };
}

function buildAuthHeaders(token: string) {
  return {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
    "x-app-lang": "vn",
  } as const;
}

function extractApiMessage(data: unknown) {
  return data && typeof data === "object" ? String((data as any).message || "") : "";
}

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function startOfWeekMonday(d: Date) {
  const copy = new Date(d);
  const day = copy.getDay(); // 0 (Sun) ... 6 (Sat)
  const daysSinceMonday = (day + 6) % 7; // Mon -> 0, Sun -> 6
  copy.setDate(copy.getDate() - daysSinceMonday);
  return startOfDay(copy);
}

function endOfWeekSunday(d: Date) {
  const start = startOfWeekMonday(d);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return endOfDay(end);
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

if (ipcMain && typeof ipcMain.handle === "function") {
  ipcMain.handle("fetch-report", async (_event, args?: FetchReportArgs) => {
    try {
      const token = trimString(args?.token);
      if (!token) return [];
      const keyword = trimString(args?.params?.keyword);

      const { weekStart, weekEnd } = getWeekRange(new Date());

      let baseRows: any[] = [];
      try {
        const ibReportPayload = {
          keyword,
          search_between: 3,
          page: 1,
          page_size: 10000,
          start_time: String(toEpochSeconds(weekStart)),
          end_time: String(toEpochSeconds(weekEnd)),
        };

        const ibReportResponse = await axios.post(
          API_ENDPOINTS.IB_REPORT,
          ibReportPayload,
          {
            headers: buildAuthHeaders(token),
            timeout: DEFAULT_TIMEOUT_MS,
            maxRedirects: 0,
            validateStatus: () => true,
          },
        );

        const reportData = ibReportResponse.data as any;
        const reportMessage = extractApiMessage(reportData);

        if (ibReportResponse.status !== 200) {
          throw new Error(reportMessage || "Request failed");
        }

        if (
          reportData &&
          typeof reportData === "object" &&
          "code" in reportData
        ) {
          const code = Number(reportData.code);
          if (!Number.isFinite(code) || code !== 200) {
            throw new Error(reportMessage || "Request failed");
          }
        }

        const reportList = Array.isArray(reportData?.data?.list)
          ? (reportData.data.list as any[])
          : [];

        baseRows = reportList
          .filter((item) => item && typeof item === "object")
          .map((item) => {
            const obj = item as any;
            const email = String(obj.email ?? obj.mail ?? "").trim();
            const realname = String(
              obj.realname ?? obj.realName ?? obj.nickname ?? "",
            ).trim();

            const depositAmount = obj.deposit_amount ?? "";
            const withdrawAmount = obj.withdraw_amount ?? "";

            return {
              ...obj,
              email,
              realname,
              deposit_amount: depositAmount,
              withdraw_amount: withdrawAmount,
            };
          });

        // Temporarily disable commission_ib_list; only return ib_report rows.
        return baseRows;
      } catch (err) {
        const message =
          err && typeof err === "object" && "message" in err
            ? String((err as any).message || "")
            : "";
        if (message && isTokenErrorMessage(message)) {
          throw err;
        }
        return baseRows;
      }
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as any).message || "")
          : "";
      return { ok: false, message: message || "Request failed" };
    }
  });

  ipcMain.handle("fetch-commission", async (_event, args?: FetchCommissionArgs) => {
    try {
      const token = trimString(args?.token);
      if (!token) return { ok: false, message: "Missing token" };

      const keywordRaw = trimString(args?.params?.keyword);
      const fallbackEmail = trimString(args?.params?.email);
      const keyword = keywordRaw || fallbackEmail;
      if (!keyword) return { ok: true, data: null };

      const { weekStart, weekEnd } = getWeekRange(new Date());

      const payload = {
        keyword,
        trade_start: toEpochSeconds(weekStart),
        trade_end: toEpochSeconds(weekEnd),
        page: 1,
        page_size: 1,
      };

      const response = await axios.post(
        API_ENDPOINTS.COMMISSION_IB_LIST,
        payload,
        {
          headers: buildAuthHeaders(token),
          timeout: DEFAULT_TIMEOUT_MS,
          maxRedirects: 0,
          validateStatus: () => true,
        },
      );

      const data = response.data as any;
      const apiMessage = extractApiMessage(data);

      if (response.status !== 200) {
        throw new Error(apiMessage || "Request failed");
      }

      if (data && typeof data === "object") {
        if ("success" in data && data.success === false) {
          throw new Error(apiMessage || "Request failed");
        }
        if ("ok" in data && data.ok === false) {
          throw new Error(apiMessage || "Request failed");
        }
        if ("status" in data) {
          const status = Number((data as any).status);
          if (Number.isFinite(status) && status !== 200) {
            throw new Error(apiMessage || "Request failed");
          }
        }
      }

      if (data && typeof data === "object" && "code" in data) {
        const code = Number(data.code);
        if (!Number.isFinite(code) || code !== 200) {
          throw new Error(apiMessage || "Request failed");
        }
      }

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
      const row = first && typeof first === "object" ? (first as any) : null;

      if (!row && apiMessage && isTokenErrorMessage(apiMessage)) {
        throw new Error(apiMessage);
      }

      return { ok: true, data: row };
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as any).message || "")
          : "";
      return { ok: false, message: message || "Request failed" };
    }
  });

  ipcMain.handle("export-excel", async (_event, args?: any) => {
    try {
      const options = {
        title: "Save Excel file",
        defaultPath: "mygtc-report.xlsx",
        filters: [{ name: "Excel Workbook", extensions: ["xlsx"] }],
      };

      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) {
        return { ok: true, cancelled: true };
      }

      const token =
        args && typeof args === "object" ? trimString((args as any).token) : "";
      const data = Array.isArray(args) ? args : args?.data;
      const rows = Array.isArray(data) ? data : [];

      const { weekStart, weekEnd } = getWeekRange(new Date());

      const enrichedRows = token
        ? await enrichRowsWithWeeklyTransactionVolume({
            token,
            rows,
            concurrency: 3,
            timeoutMs: 15_000,
            tradeStartEpochSec: toEpochSeconds(weekStart),
            tradeEndEpochSec: toEpochSeconds(weekEnd),
          })
        : rows;

      await exportRowsToXlsx(result.filePath, enrichedRows);
      return { ok: true, path: result.filePath };
    } catch {
      return { ok: false };
    }
  });

  ipcMain.handle("push-sheets", async () => {
    try {
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
