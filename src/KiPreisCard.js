import React, { useMemo, useRef, useState } from "react";

/**
 * KI-Preis Karte:
 * - Baut aus currentRow (Query + Rank1..3) einen Prompt
 * - Zeigt den Prompt in einem großen Feld
 * - "Kopy" Button kopiert den Prompt in die Zwischenablage
 *
 * Erwartete Struktur (wie in App.js):
 * currentRow = { Query: {...}, Rank1: {...}, Rank2: {...}, Rank3: {...} }
 */

const DEFAULT_RANK_KEYS = ["Rank1", "Rank2", "Rank3"];

const toStr = (v) => (v === null || v === undefined ? "" : String(v));
const isBlank = (v) => toStr(v).trim() === "";

const pickFirst = (obj, keys) => {
  for (const k of keys) {
    if (!obj) continue;
    const v = obj[k];
    if (v !== undefined && v !== null && !isBlank(v)) return v;
  }
  return "";
};

const splitSemi = (v) => {
  const s = toStr(v);
  if (isBlank(s)) return [];
  return s
    .split(";")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
};

const firstSemiValue = (v) => {
  const a = splitSemi(v);
  if (a.length) return a[0];
  return toStr(v).trim();
};

const formatNumber2 = (v) => {
  const s0 = toStr(v).trim();
  if (s0 === "") return "";
  if (s0 === "---") return "---";

  let s = s0.replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    // 1.234,56 -> 1234.56
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  if (s.startsWith("+")) s = s.slice(1);

  if (!/^-?\d+(\.\d+)?$/.test(s)) return s0;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s0;

  return n.toFixed(2).replace(".", ",");
};

const formatScore4 = (v) => {
  const s0 = toStr(v).trim();
  if (s0 === "") return "";

  let s = s0.replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  if (s.startsWith("+")) s = s.slice(1);

  if (!/^-?\d+(\.\d+)?$/.test(s)) return s0;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return s0;

  return n.toFixed(4).replace(".", ",");
};

const getQueryDetails = (queryObj) => {
  const q = queryObj || {};
  return {
    path: pickFirst(q, ["query_path", "query-path", "path", "queryPath"]),
    oz: pickFirst(q, ["query-oz", "query_oz", "oz", "queryOz"]),
    kurztext: pickFirst(q, ["query-kurztext", "query_kurztext", "kurztext", "queryKurztext"]),
    langtext: pickFirst(q, ["query_text", "query-text", "text", "queryText"]),
    einheit: pickFirst(q, ["query-einheit", "query_einheit", "einheit", "queryEinheit"]),
    menge: pickFirst(q, ["query-menge", "query_menge", "menge", "queryMenge"]),
    preis: pickFirst(q, ["query-preis", "query_preis", "preis", "unit_price", "unitPrice"]),
  };
};

const getRankDetails = (rankObj, rankKey) => {
  const r = rankObj || {};
  const prefix = (rankKey || "").toLowerCase();
  return {
    quellen: pickFirst(r, [`${prefix}-quellen`, `${prefix}_quellen`, "quellen", "sources", "source"]),
    path: pickFirst(r, [`${prefix}_path`, `${prefix}-path`, "path"]),
    oz: pickFirst(r, [`${prefix}-oz`, `${prefix}_oz`, "oz"]),
    kurztext: pickFirst(r, [`${prefix}-kurztext`, `${prefix}_kurztext`, "kurztext"]),
    langtext: pickFirst(r, [`${prefix}_text`, `${prefix}-text`, "text"]),
    einheit: pickFirst(r, [`${prefix}-einheit`, `${prefix}_einheit`, "einheit"]),
    menge: pickFirst(r, [`${prefix}-menge`, `${prefix}_menge`, "menge"]),
    preis: pickFirst(r, [`${prefix}-preis`, `${prefix}_preis`, "preis", "unit_price", "unitPrice"]),
    score: pickFirst(r, [`${prefix}_score`, `${prefix}-score`, "score", "Score"]),
  };
};

const fmtLine = (label, value) => {
  const v = toStr(value).trim();
  return v ? `- ${label}: ${v}` : "";
};

const joinNonEmpty = (lines) => lines.filter((x) => toStr(x).trim() !== "").join("\n");

function KiPreisCard({
  visible,
  currentRow,
  rankKeys = DEFAULT_RANK_KEYS,
  title = "KI-Preis",
}) {
  const taRef = useRef(null);
  const [copyMsg, setCopyMsg] = useState("");

  const prompt = useMemo(() => {
    if (!currentRow) return "Keine Daten geladen.";

    const q = getQueryDetails(currentRow.Query || {});
    const qMenge = formatNumber2(firstSemiValue(q.menge));
    const qPreis = formatNumber2(firstSemiValue(q.preis));

    const queryBlock = joinNonEmpty([
      fmtLine("Pfad", q.path),
      fmtLine("OZ", q.oz),
      fmtLine("Kurztext", q.kurztext),
      fmtLine("Langtext", q.langtext),
      fmtLine("Einheit", q.einheit),
      fmtLine("Menge", qMenge),
      // Preis ist optional – falls schon befüllt, kann er als Info rein
      qPreis && qPreis !== "---" ? `- (aktueller) Einheitspreis: ${qPreis} EUR` : "",
    ]);

    const rankBlocks = (rankKeys || []).map((rk, i) => {
      const d = getRankDetails(currentRow[rk] || {}, rk);

      const preis1 = formatNumber2(firstSemiValue(d.preis)) || "---";
      const menge1 = formatNumber2(firstSemiValue(d.menge));
      const scoreTxt = formatScore4(d.score);

      const leistungKurz = toStr(d.kurztext).trim() || "(kein Kurztext)";
      const leistungLang = toStr(d.langtext).trim();

      const header = `${i + 1}) ${rk}${scoreTxt ? ` (Score: ${scoreTxt})` : ""}`;
      const body = joinNonEmpty([
        fmtLine("Pfad", d.path),
        fmtLine("OZ", d.oz),
        `- Kurztext: ${leistungKurz}`,
        leistungLang ? `- Langtext: ${leistungLang}` : "",
        fmtLine("Einheit", d.einheit),
        menge1 ? `- Menge: ${menge1}` : "",
        `- Einheitspreis: ${preis1} EUR${d.einheit ? `/${toStr(d.einheit).trim()}` : ""}`,
        d.quellen ? `- Quellen: ${splitSemi(d.quellen).slice(0, 6).join("; ")}` : "",
      ]);

      return `${header}\n${body}`;
    });

    const ranksBlock = rankBlocks.length ? rankBlocks.join("\n\n") : "(keine Ranks vorhanden)";

    const unitHint = q.einheit ? `EUR/${toStr(q.einheit).trim()}` : "EUR pro Einheit";

    return [
      "Du bist ein erfahrener Bauingenieur und Kalkulator.",
      `Ich möchte einen plausiblen Einheitspreis (${unitHint}) für eine neue Leistung ermitteln.`,
      "",
      "### Zu bepreisende Leistung",
      queryBlock || "(keine Details zur Query vorhanden)",
      "",
      "### Vergleichbare Leistungen aus der Vergangenheit (inkl. meiner damaligen Einheitspreise)",
      ranksBlock,
      "",
      "Bitte gib mir:",
      `1) Einen empfohlenen Einheitspreis als Zahl (${unitHint}).`,
      "2) Eine kurze Begründung (max. 5 Sätze).",
      "3) Falls sinnvoll: eine Preisspanne (min/max) und welche Faktoren die Spanne treiben.",
      "4) Nenne deine Annahmen, falls Informationen fehlen oder unklar sind.",
	  "5) Versuche die Frage zunächst allein aufgrund der oben gegebenen Daten zu beantworten, ohne dein eigenes Wissen bei der Antwortgenerierung heranzuziehen.", 
	  "6) Versuche den Preis mithilfe deines eigen Wissens zu beantworten.",
	  "7) Vergleiche die zwei Ergebisse (mit und Ohne deines Wissen).",
    ].join("\n");
  }, [currentRow, rankKeys]);

  const doLegacyCopy = () => {
    // Fallback für Browser, die navigator.clipboard blocken
    const ta = taRef.current;
    if (!ta) return false;
    ta.focus();
    ta.select();
    try {
      const ok = document.execCommand("copy");
      return !!ok;
    } catch (e) {
      return false;
    }
  };

  const onCopy = async () => {
    setCopyMsg("");
    const text = prompt || "";
    if (!text.trim()) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyMsg("✅ Prompt kopiert.");
        return;
      }
    } catch (e) {
      // ignore -> fallback
    }

    const ok = doLegacyCopy();
    setCopyMsg(ok ? "✅ Prompt kopiert." : "❌ Kopieren fehlgeschlagen (Browserrechte).");
  };

  return (
    <div
      className={"rank-card ai-card " + (visible ? "visible" : "hidden")}
      style={{
        borderStyle: "dashed",
        borderWidth: 2,
      }}
    >
      <div className="card-header" style={{ alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>{title}</span>
          <small style={{ opacity: 0.75 }}>
            Prompt wird aus Query + Rank1..3 automatisch generiert
          </small>
        </div>

        {/* rechts im Header frei lassen (kein Radio-Select) */}
      </div>

      <div className="card-body">
        <textarea
          ref={taRef}
          className="langtext-area"
          style={{ width: "100%", minHeight: 260, resize: "vertical" }}
          readOnly
          value={prompt}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
          <button type="button" onClick={onCopy} disabled={!prompt || prompt === "Keine Daten geladen."}>
            Kopieren
          </button>
          <span style={{ fontSize: 13, opacity: 0.85 }}>{copyMsg}</span>
        </div>
      </div>
    </div>
  );
}

export default KiPreisCard;
