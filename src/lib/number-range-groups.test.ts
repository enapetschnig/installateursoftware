import { describe, it, expect } from "vitest";
import {
  groupNumberRanges,
  STAMMDATEN_GROUP_TITLE,
  ORPHAN_GROUP_TITLE,
} from "./number-range-groups";

const r = (id: string, doc_type: string, label: string, document_type_id: string | null = null) => ({
  id, doc_type, label, document_type_id,
});
const dt = (id: string, slug: string, name: string, category: string, sort_order: number) => ({
  id, slug, name, category, sort_order,
});

describe("groupNumberRanges", () => {
  const docTypes = [
    dt("a", "angebote", "Angebote", "Angebote", 20),
    dt("b", "auftraege", "Aufträge", "Aufträge", 50),
    dt("c", "rechnungen", "Rechnungen", "Rechnungen", 100),
    dt("d", "aufmasse", "Aufmaße", "Pläne & Nachweise", 180),
  ];

  it("legt projekt + Kontaktarten in die Stammdaten-Gruppe (nicht zu Dokumenten)", () => {
    const groups = groupNumberRanges(
      [r("1", "projekt", "Projekte"), r("2", "kunde", "Kunden"), r("3", "angebot", "Angebote", "a")],
      docTypes,
    );
    const stamm = groups.find((g) => g.title === STAMMDATEN_GROUP_TITLE);
    expect(stamm).toBeTruthy();
    const stammTypes = stamm!.rows.map((x) => x.range.doc_type);
    expect(stammTypes).toContain("projekt");
    expect(stammTypes).toContain("kunde");
    expect(stammTypes).not.toContain("angebot");
  });

  it("gruppiert Dokument-Kreise nach Kategorie und sortiert nach sort_order", () => {
    const groups = groupNumberRanges(
      [r("3", "rechnung", "alt", "c"), r("4", "angebot", "alt", "a"), r("5", "auftrag", "alt", "b")],
      docTypes,
    );
    const docTitles = groups.filter((g) => g.title !== STAMMDATEN_GROUP_TITLE).map((g) => g.title);
    // Angebote(20) vor Aufträge(50) vor Rechnungen(100)
    expect(docTitles).toEqual(["Angebote", "Aufträge", "Rechnungen"]);
  });

  it("nimmt das Anzeige-Label aus document_types.name, nicht aus dem alten range.label", () => {
    const groups = groupNumberRanges([r("9", "measurement", "Aufmaß (alt)", "d")], docTypes);
    const row = groups.flatMap((g) => g.rows).find((x) => x.range.id === "9");
    expect(row?.label).toBe("Aufmaße");
  });

  it("verknüpft auch per Slug, wenn document_type_id fehlt", () => {
    const groups = groupNumberRanges([r("10", "angebote", "x", null)], docTypes);
    const row = groups.flatMap((g) => g.rows).find((x) => x.range.id === "10");
    expect(row?.label).toBe("Angebote");
  });

  it("legt Kreise ohne Dokumentart in die Prüf-Gruppe", () => {
    const groups = groupNumberRanges([r("11", "regiebericht", "Regieberichte")], docTypes);
    const orphan = groups.find((g) => g.title === ORPHAN_GROUP_TITLE);
    expect(orphan?.rows[0].range.id).toBe("11");
  });
});
