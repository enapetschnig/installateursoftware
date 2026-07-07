// ============================================================
// Tests fuer src/components/voice/VoiceAngebotPrestepModal.tsx
//
// Wie auch SpeechInput.test.ts: kein RTL/jsdom im Projekt, daher
// testen wir die exportierten Pure-Logic-Helper. UI-Smoke-Tests
// sind skipped + dokumentiert.
// ============================================================

import { describe, expect, it } from "vitest";
import { contactDisplayLabel } from "./VoiceAngebotPrestepModal";
import type { Contact } from "../../lib/types";

function makeContact(overrides: Partial<Contact>): Contact {
  return {
    id: "11111111-1111-1111-8111-111111111111",
    contact_number: null,
    customer_number: null,
    type: "kunde",
    customer_type: "privat",
    status: "aktiv",
    salutation: null,
    title: null,
    first_name: null,
    last_name: null,
    company: null,
    uid_number: null,
    email: null,
    invoice_email: null,
    phone: null,
    mobile: null,
    website: null,
    street: null,
    address_extra: null,
    recipient_extra_line1: null,
    recipient_extra_line2: null,
    zip: null,
    city: null,
    country: null,
    notes: null,
    address_form: "sie",
    payment_term_days: null,
    skonto_percent: null,
    skonto_days: null,
    is_invoice_recipient: false,
    auto_accept_supplements: false,
    payment_method: null,
    payment_note: null,
    default_discount_percent: null,
    default_surcharge_percent: null,
    in_payment_term_days: null,
    in_skonto_percent: null,
    in_skonto_days: null,
    in_payment_method: null,
    in_payment_note: null,
    in_discount_percent: null,
    created_at: "2026-06-30T00:00:00Z",
    updated_at: null,
    ...overrides,
  } as Contact;
}

describe("VoiceAngebotPrestepModal / contactDisplayLabel", () => {
  it("zeigt Firma + Person, wenn beides vorhanden", () => {
    const c = makeContact({ company: "ACME GmbH", first_name: "Max", last_name: "Mustermann" });
    expect(contactDisplayLabel(c)).toBe("ACME GmbH — Max Mustermann");
  });

  it("zeigt nur Firma, wenn kein Person-Name", () => {
    const c = makeContact({ company: "ACME GmbH" });
    expect(contactDisplayLabel(c)).toBe("ACME GmbH");
  });

  it("zeigt nur Person, wenn keine Firma", () => {
    const c = makeContact({ first_name: "Anna", last_name: "Müller" });
    expect(contactDisplayLabel(c)).toBe("Anna Müller");
  });

  it("zeigt nur Vornamen, wenn Nachname fehlt", () => {
    const c = makeContact({ first_name: "Anna" });
    expect(contactDisplayLabel(c)).toBe("Anna");
  });

  it("Fallback wenn nichts gesetzt", () => {
    const c = makeContact({});
    expect(contactDisplayLabel(c)).toBe("(unbenannter Kontakt)");
  });

  it("trimmt Whitespace bei leerem Vornamen", () => {
    const c = makeContact({ first_name: "", last_name: "Müller" });
    expect(contactDisplayLabel(c)).toBe("Müller");
  });
});

// ── UI-Smoke-Tests (TODO bei jsdom) ─────────────────────────
describe("VoiceAngebotPrestepModal / UI-Smoke (skipped bis jsdom)", () => {
  it.skip(
    "[1] Default: Submit deaktiviert ohne Auswahl",
    /* Begruendung: Braucht RTL+jsdom. Logik:
         render(<VoiceAngebotPrestepModal open onClose={...} onConfirm={...} />)
         await waitFor(() => expect(screen.getByTestId('vap-submit')).toBeDisabled())
    */
    () => {},
  );

  it.skip(
    "[2] Kunden-Auswahl aktiviert Submit",
    /* render → fireEvent.change('vap-contact-select', { target: { value: 'c-1' } })
       → submit ist aktiv → click → onConfirm aufgerufen mit { contactId: 'c-1', projectId: null }
    */
    () => {},
  );

  it.skip(
    "[3] Projekt mit contact_id → setzt Kunde automatisch",
    /* projectsLoader liefert [{ id:'p-1', title:'X', contact_id:'c-1' }],
       contactsLoader liefert [{ id:'c-1' }]
       → fireEvent.change('vap-project-select', 'p-1') → contact_id wird c-1
    */
    () => {},
  );

  it.skip(
    "[4] Quick-Create-Pfad: legt Kontakt an + selektiert ihn",
    /* click 'Neuen Kunden anlegen' → mode wechselt → Vorname+Nachname → submit
       → quickCreateContact() wird mit Payload aufgerufen → liefert Contact{id:'c-new'}
       → mode geht auf picker zurueck → selectedContactId === 'c-new'
    */
    () => {},
  );
});
