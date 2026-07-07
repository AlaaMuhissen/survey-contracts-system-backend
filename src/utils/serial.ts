// src/utils/serial.ts
export function newId(prefix = "") {
  // time-based (sortable) + random tail
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return prefix ? `${prefix}_${t}${r}` : `${t}${r}`;
}

export const id = {
  survey: () => newId("sv"),
  company: () => newId("co"),
  project: () => newId("prj"),
  contract: () => newId("ct"),
  submission: () => newId("sub"),
  worklog: () => newId("wl"),
  user: () => newId("usr"),
};
