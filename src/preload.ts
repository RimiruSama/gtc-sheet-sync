import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  fetchReport: (token?: string, params?: { keyword?: string }) =>
    ipcRenderer.invoke("fetch-report", { token, params }),
  fetchCommission: (token?: string, params?: { keyword?: string; email?: string }) =>
    ipcRenderer.invoke("fetch-commission", { token, params }),
  exportExcel: (data: any[]) => ipcRenderer.invoke("export-excel", data),
  pushSheets: (data: any[]) => ipcRenderer.invoke("push-sheets", data),
});
