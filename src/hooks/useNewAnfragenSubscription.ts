// ============================================================
// B4Y SuperAPP – Realtime-Hook fuer neue Anfragen
// ------------------------------------------------------------
// Abonniert INSERTs auf public.anfragen via Supabase-Realtime und
// ruft den onNew-Callback einmal pro neuer Anfrage auf.
//
// Voraussetzung (DB):
//   ALTER PUBLICATION supabase_realtime ADD TABLE public.anfragen;
//   (siehe Migration 0121)
//
// Realtime liefert nur Events, die der User-Token via RLS lesen darf
// (organization_id = current_org_id()). Wir filtern trotzdem zusaetzlich
// auf "anfrage hat eine source" als kleine Schutz-Heuristik.
//
// Tipps:
//   - onNew sollte stabil referenziert sein (useCallback) – sonst legt
//     der Hook bei jedem Render einen neuen Channel an.
//   - Mehrere Komponenten koennen den Hook gleichzeitig benutzen – der
//     Channel-Name enthaelt einen kleinen Suffix, damit sie sich nicht
//     ueberschreiben.
// ============================================================
import { useEffect } from "react";
import { supabase } from "../lib/supabase";
import type { AnfrageRow } from "../lib/anfragen";

let channelCounter = 0;

export function useNewAnfragenSubscription(
  onNew?: (anfrage: AnfrageRow) => void,
): void {
  useEffect(() => {
    if (!onNew) return;
    channelCounter += 1;
    const name = `anfragen-insert-${channelCounter}-${Date.now()}`;
    const channel = supabase
      .channel(name)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "anfragen" },
        (payload) => {
          const row = payload.new as Partial<AnfrageRow> | undefined;
          if (!row || !row.id || !row.source) return;
          onNew(row as AnfrageRow);
        },
      )
      .subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [onNew]);
}
