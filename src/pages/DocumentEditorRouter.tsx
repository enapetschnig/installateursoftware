// ============================================================
// B4Y SuperAPP – Dispatcher für /dokumente/:id
// Wählt anhand der Dokumentstruktur der Dokumentart den passenden Editor:
//   'form'  → FormDocumentEditor (Formular/Bericht)
//   sonst   → TextDocumentEditor (Brief/Anschreiben, Default)
// Ein Dokument ist entweder 'text' oder 'form'; beide Editoren laden ihren
// Datensatz selbst. Hier nur eine schlanke Struktur-Abfrage vorab.
// ============================================================
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Spinner } from "../components/ui";
import { docStructure } from "../lib/documents";
import TextDocumentEditor from "./TextDocumentEditor";
import FormDocumentEditor from "./FormDocumentEditor";

export default function DocumentEditorRouter() {
  const { id } = useParams();
  const [mode, setMode] = useState<"loading" | "form" | "text">("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!id) {
        setMode("text");
        return;
      }
      const { data } = await supabase.from("documents").select("document_type_id").eq("id", id).maybeSingle();
      const typeId = (data as { document_type_id?: string | null } | null)?.document_type_id ?? null;
      let isForm = false;
      if (typeId) {
        const { data: dt } = await supabase
          .from("document_types")
          .select("document_structure")
          .eq("id", typeId)
          .maybeSingle();
        isForm = docStructure(dt as { document_structure?: string | null } | null) === "form";
      }
      if (alive) setMode(isForm ? "form" : "text");
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  if (mode === "loading")
    return (
      <div className="glass p-6">
        <Spinner />
      </div>
    );
  return mode === "form" ? <FormDocumentEditor /> : <TextDocumentEditor />;
}
