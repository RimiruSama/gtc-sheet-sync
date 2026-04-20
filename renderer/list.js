(() => {
  const TOKEN_STORAGE_KEY = "gtc.token";

  const changeTokenBtn = document.getElementById("changeTokenBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const recordCount = document.getElementById("recordCount");
  const recordsTbody = document.getElementById("recordsTbody");
  const errorBanner = document.getElementById("errorBanner");
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");
  const pageSizeSelect = document.getElementById("pageSizeSelect");
  const firstPageBtn = document.getElementById("firstPageBtn");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  const lastPageBtn = document.getElementById("lastPageBtn");
  const pageInfo = document.getElementById("pageInfo");
  const rangeInfo = document.getElementById("rangeInfo");
  const exportExcelBtn = document.getElementById("exportExcelBtn");
  const exportSheetBtn = document.getElementById("exportSheetBtn");

  /** @type {any[]} */
  let allRows = [];
  let page = 1;
  let pageSize = 10;
  let searchQuery = "";
  let keyword = "";
  let isLoading = false;
  let isCommissionLoading = false;

  /** @type {Map<string, any>} */
  const commissionCacheByEmail = new Map();
  /** @type {Set<string>} */
  const commissionInFlightByEmail = new Set();
  let commissionPrefetchRunId = 0;

  function getToken() {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  }

  function clearToken() {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  function goWelcome() {
    window.location.href = "./index.html";
  }

  function escapeHtml(input) {
    const div = document.createElement("div");
    div.textContent = input == null ? "" : String(input);
    return div.innerHTML;
  }

  function setError(message) {
    if (!errorBanner) return;
    const msg = String(message || "").trim();
    errorBanner.textContent = msg;
    errorBanner.hidden = !msg;
  }

  function setLoading(next) {
    isLoading = Boolean(next);
    const busy = isLoading;
    if (refreshBtn) refreshBtn.disabled = busy;
    if (searchBtn) searchBtn.disabled = busy;
    if (exportExcelBtn) exportExcelBtn.disabled = busy;
    if (exportSheetBtn) exportSheetBtn.disabled = busy;
    if (pageSizeSelect) pageSizeSelect.disabled = busy;
    if (firstPageBtn) firstPageBtn.disabled = busy || page <= 1;
    if (prevPageBtn) prevPageBtn.disabled = busy || page <= 1;
    if (nextPageBtn) nextPageBtn.disabled = busy;
    if (lastPageBtn) lastPageBtn.disabled = busy;
  }

  function setCommissionLoading(next) {
    isCommissionLoading = Boolean(next);
    setLoading(isLoading);
  }

  async function exportExcel() {
    if (isLoading) return;
    try {
      setError("");
      const api = window.api;
      if (!api || typeof api.exportExcel !== "function") {
        setError(
          "Tính năng xuất Excel chưa sẵn sàng. Vui lòng khởi động lại ứng dụng.",
        );
        return;
      }

      const rows = getFilteredRows();
      setLoading(true);
      const result = await api.exportExcel(rows, getToken());
      if (result && typeof result === "object" && "ok" in result) {
        if (!result.ok)
          throw new Error("Không thể xuất Excel. Vui lòng thử lại.");
      }
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String(err.message || "")
          : "";
      setError(message || "Không thể xuất Excel. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }

  async function exportSheet() {
    if (isLoading) return;
    try {
      setError("");
      const api = window.api;
      if (!api || typeof api.pushSheets !== "function") {
        setError(
          "Tính năng xuất lên Sheet chưa sẵn sàng. Vui lòng khởi động lại ứng dụng.",
        );
        return;
      }

      const rows = getFilteredRows();
      setLoading(true);
      const result = await api.pushSheets(rows);
      if (result && typeof result === "object" && "ok" in result) {
        if (!result.ok)
          throw new Error("Không thể xuất lên Sheet. Vui lòng thử lại.");
      }
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String(err.message || "")
          : "";
      setError(message || "Không thể xuất lên Sheet. Vui lòng thử lại.");
    } finally {
      setLoading(false);
    }
  }

  function renderSkeletonRows(count) {
    const n = clampInt(count, 3, 12);
    const html = Array.from({ length: n })
      .map(() => {
        return `<tr>
          <td class="col-idx"><span class="skeleton skeleton--short"></span></td>
          <td class="col-email"><span class="skeleton"></span></td>
          <td class="col-name"><span class="skeleton skeleton--medium"></span></td>
          <td class="col-num"><span class="skeleton skeleton--short"></span></td>
          <td class="col-num"><span class="skeleton skeleton--short"></span></td>
          <td class="col-num"><span class="skeleton skeleton--short"></span></td>
          <td class="col-num col-commission"><span class="skeleton skeleton--short"></span></td>
        </tr>`;
      })
      .join("");
    recordsTbody.innerHTML = html;
  }

  function formatNumber(value) {
    if (value == null || value === "") return "";
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(n);
  }

  function clampInt(value, min, max) {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, Math.trunc(n)));
  }

  function getTotalPages(total) {
    if (!total) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }

  /** @param {any} obj */
  function getWeeklyTransactionVolumeRaw(obj) {
    const o = obj && typeof obj === "object" ? obj : {};
    return (
      o.weeklyTransactionVolume ??
      o.weekly_transaction_volume ??
      o.weeklyVolume ??
      o.commission_all ??
      o.commissionAll ??
      (o.commission_amount && typeof o.commission_amount === "object"
        ? o.commission_amount.commission_all
        : "") ??
      ""
    );
  }

  function normalizeSearchText(input) {
    return String(input ?? "")
      .trim()
      .toLowerCase();
  }

  function normalizeKeyword(input) {
    return String(input ?? "").trim();
  }

  function syncSearchStateFromInput() {
    if (searchInput && searchInput instanceof HTMLInputElement) {
      keyword = normalizeKeyword(searchInput.value);
      searchQuery = normalizeSearchText(searchInput.value);
    } else {
      keyword = "";
      searchQuery = "";
    }
  }

  function resetFilters() {
    if (searchInput && searchInput instanceof HTMLInputElement) {
      searchInput.value = "";
    }
    keyword = "";
    searchQuery = "";
    page = 1;
  }

  /** @param {any} row */
  function rowMatchesQuery(row) {
    if (!searchQuery) return true;
    const obj = row && typeof row === "object" ? row : {};
    const email = String(obj.email ?? obj.mail ?? "");
    const fullName = String(obj.fullName ?? obj.full_name ?? obj.name ?? "");
    const haystack = `${email} ${fullName}`.toLowerCase();
    return haystack.includes(searchQuery);
  }

  function getFilteredRows() {
    if (!searchQuery) return allRows;
    return allRows.filter(rowMatchesQuery);
  }

  function updatePagerUi() {
    const total = getFilteredRows().length;
    const totalPages = getTotalPages(total);
    page = clampInt(page, 1, totalPages);

    if (pageInfo) pageInfo.textContent = `Trang ${page}/${totalPages}`;

    if (firstPageBtn) firstPageBtn.disabled = page <= 1;
    if (prevPageBtn) prevPageBtn.disabled = page <= 1;
    if (nextPageBtn) nextPageBtn.disabled = page >= totalPages;
    if (lastPageBtn) lastPageBtn.disabled = page >= totalPages;

    if (rangeInfo) {
      if (!total) {
        rangeInfo.textContent = "";
      } else {
        const start = (page - 1) * pageSize + 1;
        const end = Math.min(total, page * pageSize);
        rangeInfo.textContent = `(${start}–${end} / ${total})`;
      }
    }
  }

  /** @param {any[]} rows @param {number} startIndex @param {number} totalFiltered */
  function renderRows(rows, startIndex, totalFiltered) {
    recordCount.textContent = String(totalFiltered);

    if (!rows.length) {
      if (totalFiltered === 0 && allRows.length > 0 && searchQuery) {
        recordsTbody.innerHTML =
          '<tr><td class="empty" colspan="7">Không tìm thấy kết quả phù hợp.</td></tr>';
        return;
      }
      recordsTbody.innerHTML =
        '<tr><td class="empty" colspan="7">Chưa có dữ liệu. Bấm "Làm mới" để tải bản ghi.</td></tr>';
      return;
    }

    const html = rows
      .map((r, idx) => {
        const obj = r && typeof r === "object" ? r : {};
        const email = String(obj.email ?? obj.mail ?? "");
        const fullName = String(
          obj.realname ?? obj.realName ?? obj.nickname ?? "",
        );
        const totalDeposits =
          obj.totalDeposits ??
          obj.total_deposits ??
          obj.deposits ??
          obj.deposit_amount ??
          obj.depositAmount ??
          "";
        const totalWithdrawals =
          obj.totalWithdrawals ??
          obj.total_withdrawals ??
          obj.withdrawals ??
          obj.withdraw_amount ??
          obj.withdrawAmount ??
          "";
        const remainingBalance =
          obj.remainingBalance ?? obj.remaining_balance ?? obj.balance ?? "";
        const weeklyTransactionVolumeRaw = getWeeklyTransactionVolumeRaw(obj);

        return `<tr>
          <td class="col-idx">${startIndex + idx + 1}</td>
          <td class="col-email">${escapeHtml(email)}</td>
          <td class="col-name">${escapeHtml(fullName)}</td>
          <td class="col-num">${escapeHtml(formatNumber(totalDeposits))}</td>
          <td class="col-num">${escapeHtml(formatNumber(totalWithdrawals))}</td>
          <td class="col-num">${escapeHtml(formatNumber(remainingBalance))}</td>
          <td class="col-num col-commission" data-email="${escapeHtml(
            String(email || ""),
          )}">${escapeHtml(
            weeklyTransactionVolumeRaw == null
              ? ""
              : String(weeklyTransactionVolumeRaw),
          )}</td>
        </tr>`;
      })
      .join("");

    recordsTbody.innerHTML = html;
  }

  function renderCommissionCellLoading(email) {
    if (!recordsTbody) return;
    const safeEmail = String(email || "");
    if (!safeEmail) return;
    const cells = recordsTbody.querySelectorAll(
      `td.col-commission[data-email="${CSS.escape(safeEmail)}"]`,
    );
    if (!cells || cells.length === 0) return;
    for (const cell of cells) {
      cell.innerHTML = '<span class="skeleton skeleton--short"></span>';
    }
  }

  function renderCommissionCellValue(email, value) {
    if (!recordsTbody) return;
    const safeEmail = String(email || "");
    if (!safeEmail) return;
    const cells = recordsTbody.querySelectorAll(
      `td.col-commission[data-email="${CSS.escape(safeEmail)}"]`,
    );
    if (!cells || cells.length === 0) return;
    const text = value == null ? "" : String(value);
    for (const cell of cells) {
      cell.textContent = text;
    }
  }

  function getCommissionKeywordFromRow(row) {
    const obj = row && typeof row === "object" ? row : {};
    const email = String(obj.email ?? obj.mail ?? "").trim();
    return email;
  }

  async function fetchCommissionByKeyword(token, keyword) {
    const api = window.api;
    if (!api || typeof api.fetchCommission !== "function") return null;
    const result = await api.fetchCommission(token, { keyword });
    if (result && typeof result === "object" && "ok" in result) {
      if (!result.ok) {
        const message = "message" in result ? String(result.message || "") : "";
        throw new Error(message || "Request failed");
      }
      return "data" in result ? result.data : null;
    }
    return null;
  }

  async function runWithConcurrencyLimit(items, limit, fn) {
    const safeLimit = Math.max(1, Math.trunc(limit || 1));
    const results = new Array(items.length);
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

  async function prefetchCommissionForFilteredRows(filteredRows) {
    const token = getToken();
    if (!token) return;
    if (!Array.isArray(filteredRows) || filteredRows.length === 0) return;

    const runId = (commissionPrefetchRunId += 1);

    const tasks = filteredRows
      .map((r) => (r && typeof r === "object" ? r : {}))
      .map((obj) => {
        const email = String(obj.email ?? obj.mail ?? "").trim();
        const keyword = getCommissionKeywordFromRow(obj);
        return { email, keyword };
      })
      .filter((t) => Boolean(t.email) && Boolean(t.keyword));

    if (!tasks.length) return;

    const unique = new Map();
    for (const t of tasks) {
      if (!unique.has(t.email)) unique.set(t.email, t);
    }
    const deduped = Array.from(unique.values());

    const missing = deduped.filter(
      (t) =>
        !commissionCacheByEmail.has(t.email) &&
        !commissionInFlightByEmail.has(t.email),
    );

    if (!missing.length) return;

    try {
      setCommissionLoading(true);

      for (const t of missing) {
        commissionInFlightByEmail.add(t.email);
      }

      await runWithConcurrencyLimit(missing, 3, async (t) => {
        try {
          const commissionRow = await fetchCommissionByKeyword(
            token,
            t.keyword,
          );
          commissionCacheByEmail.set(t.email, commissionRow);
          const raw = getWeeklyTransactionVolumeRaw(commissionRow);
          if (runId === commissionPrefetchRunId) {
            renderCommissionCellValue(t.email, raw == null ? "" : String(raw));
          }
        } catch {
          // Keep the table usable even if commission fetch fails.
        } finally {
          commissionInFlightByEmail.delete(t.email);
        }
      });
    } finally {
      setCommissionLoading(false);
    }
  }

  async function loadCommissionForVisibleRows(visibleRows) {
    if (!Array.isArray(visibleRows) || visibleRows.length === 0) return;

    for (const r of visibleRows) {
      const obj = r && typeof r === "object" ? r : {};
      const email = String(obj.email ?? obj.mail ?? "").trim();
      if (!email) continue;

      if (commissionCacheByEmail.has(email)) {
        const cached = commissionCacheByEmail.get(email);
        const raw = getWeeklyTransactionVolumeRaw(cached);
        renderCommissionCellValue(email, raw == null ? "" : String(raw));
      } else {
        renderCommissionCellLoading(email);
      }
    }
  }

  function renderPage() {
    const filteredRows = getFilteredRows();
    const total = filteredRows.length;
    const totalPages = getTotalPages(total);
    page = clampInt(page, 1, totalPages);

    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const rows = filteredRows.slice(start, end);
    renderRows(rows, start, total);
    updatePagerUi();
    void loadCommissionForVisibleRows(rows);
    void prefetchCommissionForFilteredRows(filteredRows);
  }

  async function refresh() {
    if (isLoading) return;
    try {
      setError("");
      const token = getToken();
      if (!token) {
        goWelcome();
        return;
      }

      const api = window.api;
      if (!api || typeof api.fetchReport !== "function") {
        setError("API chưa sẵn sàng. Vui lòng khởi động lại ứng dụng.");
        allRows = [];
        page = 1;
        renderPage();
        return;
      }

      setLoading(true);
      renderSkeletonRows(pageSize);

      syncSearchStateFromInput();
      const result = await api.fetchReport(token, { keyword });
      if (Array.isArray(result)) {
        allRows = result;
      } else if (result && typeof result === "object" && "ok" in result) {
        const ok = Boolean(result.ok);
        const message = "message" in result ? String(result.message || "") : "";
        if (!ok) {
          throw new Error(
            message || "Không thể tải dữ liệu. Vui lòng thử lại.",
          );
        }
        const data = "data" in result ? result.data : [];
        allRows = Array.isArray(data) ? data : [];
      } else {
        allRows = [];
      }
      page = 1;
      renderPage();
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err
          ? String(err.message || "")
          : "";
      setError(message || "Không thể tải dữ liệu. Vui lòng thử lại.");
      renderPage();
    } finally {
      setLoading(false);
    }
  }

  changeTokenBtn.addEventListener("click", () => {
    clearToken();
    goWelcome();
  });

  refreshBtn.addEventListener("click", () => {
    resetFilters();
    void refresh();
  });

  if (exportExcelBtn) {
    exportExcelBtn.addEventListener("click", () => {
      void exportExcel();
    });
  }

  if (exportSheetBtn) {
    exportSheetBtn.addEventListener("click", () => {
      void exportSheet();
    });
  }

  if (searchInput && searchInput instanceof HTMLInputElement) {
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void refresh();
      }
    });
  }

  if (searchBtn) {
    searchBtn.addEventListener("click", () => {
      void refresh();
    });
  }

  if (pageSizeSelect && pageSizeSelect instanceof HTMLSelectElement) {
    pageSize = clampInt(pageSizeSelect.value, 1, 1000);
    pageSizeSelect.addEventListener("change", () => {
      pageSize = clampInt(pageSizeSelect.value, 1, 1000);
      page = 1;
      renderPage();
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      page = page - 1;
      renderPage();
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      page = page + 1;
      renderPage();
    });
  }

  if (firstPageBtn) {
    firstPageBtn.addEventListener("click", () => {
      page = 1;
      renderPage();
    });
  }

  if (lastPageBtn) {
    lastPageBtn.addEventListener("click", () => {
      const total = getFilteredRows().length;
      const totalPages = getTotalPages(total);
      page = totalPages;
      renderPage();
    });
  }

  // Boot
  if (!getToken()) {
    goWelcome();
  } else {
    void refresh();
  }
})();
