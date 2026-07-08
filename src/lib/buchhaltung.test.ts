// Tests für src/lib/buchhaltung.ts – reine Helfer (ohne Netzwerk/DB).
import { describe, it, expect } from "vitest";

import {
  isOverdue,
  EINGANG_STATUS_LABEL,
  EINGANG_STATUS_TONE,
  type EingangsrechnungStatus,
} from "./buchhaltung";

describe("isOverdue", () => {
  it("ist überfällig bei offenem Status und Fälligkeit in der Vergangenheit", () => {
    expect(isOverdue({ status: "offen", due_date: "2000-01-01" })).toBe(true);
    expect(isOverdue({ status: "geprueft", due_date: "2000-01-01" })).toBe(true);
    expect(isOverdue({ status: "freigegeben", due_date: "2000-01-01" })).toBe(true);
  });

  it("ist NICHT überfällig bei Fälligkeit in der Zukunft", () => {
    expect(isOverdue({ status: "offen", due_date: "2999-12-31" })).toBe(false);
  });

  it("ist NICHT überfällig, wenn bezahlt oder storniert", () => {
    expect(isOverdue({ status: "bezahlt", due_date: "2000-01-01" })).toBe(false);
    expect(isOverdue({ status: "storniert", due_date: "2000-01-01" })).toBe(false);
  });

  it("ist NICHT überfällig ohne Fälligkeitsdatum", () => {
    expect(isOverdue({ status: "offen", due_date: null })).toBe(false);
  });
});

describe("Status-Maps", () => {
  const all: EingangsrechnungStatus[] = ["offen", "geprueft", "freigegeben", "bezahlt", "storniert"];
  it("hat Label + Tone für jeden Status", () => {
    for (const s of all) {
      expect(EINGANG_STATUS_LABEL[s]).toBeTruthy();
      expect(EINGANG_STATUS_TONE[s]).toBeTruthy();
    }
  });
});
