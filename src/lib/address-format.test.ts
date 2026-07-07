import { describe, it, expect } from "vitest";
import {
  splitStreet,
  normalizeStreetQuery,
  reattachHouseNo,
  rankByContext,
  AddressSuggestion,
} from "./address-format";

const sug = (street: string, zip = "", city = "", country = "Österreich"): AddressSuggestion => ({
  street,
  zip,
  city,
  country,
  label: [street, [zip, city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
});

describe("splitStreet", () => {
  it("trennt Straße und Hausnummer", () => {
    expect(splitStreet("Hyegasse 7")).toEqual({ street: "Hyegasse", houseNo: "7" });
    expect(splitStreet("Getreidegasse 7")).toEqual({ street: "Getreidegasse", houseNo: "7" });
    expect(splitStreet("Schrottgasse 7")).toEqual({ street: "Schrottgasse", houseNo: "7" });
  });

  it("ohne Hausnummer bleibt die Straße erhalten", () => {
    expect(splitStreet("Hyegasse")).toEqual({ street: "Hyegasse", houseNo: "" });
  });

  it("Bindestrich-Straßen werden nicht zerschnitten", () => {
    expect(splitStreet("Maria-Theresien-Straße 7")).toEqual({
      street: "Maria-Theresien-Straße",
      houseNo: "7",
    });
  });

  it("Hausnummer-Varianten (Buchstabe, Slash, Bereich)", () => {
    expect(splitStreet("Hauptstraße 7a")).toEqual({ street: "Hauptstraße", houseNo: "7a" });
    expect(splitStreet("Hauptstraße 7/2")).toEqual({ street: "Hauptstraße", houseNo: "7/2" });
    expect(splitStreet("Hauptstraße 7-9")).toEqual({ street: "Hauptstraße", houseNo: "7-9" });
  });
});

describe("normalizeStreetQuery", () => {
  it("räumt Mehrfach-Leerzeichen und Rand-Kommata auf", () => {
    expect(normalizeStreetQuery("  Hyegasse  ")).toBe("Hyegasse");
    expect(normalizeStreetQuery("Maria-Theresien-Straße ,")).toBe("Maria-Theresien-Straße");
  });
});

describe("reattachHouseNo", () => {
  it("hängt die Hausnummer an einen Straßentreffer ohne Nummer an", () => {
    const r = reattachHouseNo(sug("Hyegasse", "1030", "Wien"), "7");
    expect(r.street).toBe("Hyegasse 7");
    expect(r.label).toContain("Hyegasse 7");
    expect(r.label).toContain("1030 Wien");
  });

  it("hängt nichts an, wenn der Treffer bereits eine Nummer hat", () => {
    const r = reattachHouseNo(sug("Hyegasse 5", "1030", "Wien"), "7");
    expect(r.street).toBe("Hyegasse 5");
  });

  it("ohne Hausnummer bleibt der Treffer unverändert", () => {
    const base = sug("Hyegasse", "1030", "Wien");
    expect(reattachHouseNo(base, "")).toEqual(base);
  });
});

describe("rankByContext", () => {
  const list = [
    sug("Hyegasse 7", "8010", "Graz"),
    sug("Hyegasse 7", "1030", "Wien"),
    sug("Hyegasse 7", "4020", "Linz"),
  ];

  it("ohne Kontext bleibt die Reihenfolge stabil", () => {
    expect(rankByContext(list).map((s) => s.city)).toEqual(["Graz", "Wien", "Linz"]);
  });

  it("priorisiert den PLZ-/Ort-Treffer", () => {
    const ranked = rankByContext(list, { zip: "1030", city: "Wien" });
    expect(ranked[0].city).toBe("Wien");
  });

  it("Ort-Kontext allein reicht zum Priorisieren", () => {
    const ranked = rankByContext(list, { city: "Linz" });
    expect(ranked[0].city).toBe("Linz");
  });
});
