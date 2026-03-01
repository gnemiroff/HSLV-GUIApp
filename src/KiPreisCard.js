import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * KI-Preis Karte:
 * - Prompt wird aus Query + Rank1..3 generiert
 * - "Kopieren" kopiert Prompt
 * - "Ausführen" sendet Prompt (genau so wie angezeigt) an OpenAI Responses API
 * - Antwort (JSON) füllt 3 Felder
 */

// -------------------- Konfiguration --------------------
// 1) API Key (nur DEV / lokal; für PROD bitte Proxy nutzen!)
const GPT_KEY = (process.env.REACT_APP_OPENAI_API_KEY || "").trim(); // <-- hier später Key setzen oder .env
// 2) Model
const GPT_MODEL = (process.env.REACT_APP_OPENAI_MODEL || "gpt-5-mini").trim();
// 3) Optionaler Proxy (empfohlen!): wenn gesetzt, wird statt OpenAI direkt dieser Endpoint aufgerufen
const GPT_PROXY_URL = (process.env.REACT_APP_OPENAI_PROXY_URL || "").trim();

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

// Rank Keys (Default)
const DEFAULT_RANK_KEYS = ["Rank1", "Rank2", "Rank3"];

// Schema für Structured Outputs (stabil parsebar)
const KI_PREIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    preis_comp: { type: "number" },
    preis_ai: { type: "number" },
    begruendung: { type: "string" },
  },
  required: ["preis_comp", "preis_ai", "begruendung"],
};

// -------------------- Helpers --------------------
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
  return a.length ? a[0] : toStr(v).trim();
};

// Text stark komprimieren (Tokens sparen)
const compactText = (v, maxLen = 240) => {
  const s = toStr(v).replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + "…";
};

// "12,34" / "1.234,56" / "1234.56" -> number|null
const parseNumberLoose = (v) => {
  const s0 = toStr(v).trim();
  if (!s0 || s0 === "---") return null;

  let s = s0.replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  if (s.startsWith("+")) s = s.slice(1);

  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

const formatNumber2 = (v) => {
  const n = typeof v === "number" ? v : parseNumberLoose(v);
  if (n === null) return "";
  return n.toFixed(2).replace(".", ",");
};

const getQueryDetails = (queryObj) => {
  const q = queryObj || {};
  return {
    oz: pickFirst(q, ["query-oz", "query_oz", "oz", "queryOz"]),
    kurztext: pickFirst(q, ["query-kurztext", "query_kurztext", "kurztext", "queryKurztext"]),
    langtext: pickFirst(q, ["query_text", "query-text", "text", "queryText"]),
    einheit: pickFirst(q, ["query-einheit", "query_einheit", "einheit", "queryEinheit"]),
    menge: pickFirst(q, ["query-menge", "query_menge", "menge", "queryMenge"]),
  };
};

const getRankDetails = (rankObj, rankKey) => {
  const r = rankObj || {};
  const prefix = (rankKey || "").toLowerCase();
  return {
    oz: pickFirst(r, [`${prefix}-oz`, `${prefix}_oz`, "oz"]),
    kurztext: pickFirst(r, [`${prefix}-kurztext`, `${prefix}_kurztext`, "kurztext"]),
    langtext: pickFirst(r, [`${prefix}_text`, `${prefix}-text`, "text"]),
    einheit: pickFirst(r, [`${prefix}-einheit`, `${prefix}_einheit`, "einheit"]),
    menge: pickFirst(r, [`${prefix}-menge`, `${prefix}_menge`, "menge"]),
    preis: pickFirst(r, [`${prefix}-preis`, `${prefix}_preis`, "preis", "unit_price", "unitPrice"]),
    score: pickFirst(r, [`${prefix}_score`, `${prefix}-score`, "score", "Score"]),
  };
};

// Response ggf. “unwrap”, falls Proxy die OpenAI Antwort verschachtelt
const unwrapResponse = (x) => {
  if (!x) return x;
  // häufige Wrapper-Patterns:
  if (x.response && (x.response.output || x.response.output_text || x.response.choices)) return x.response;
  if (x.data && (x.data.output || x.data.output_text || x.data.choices)) return x.data;
  if (x.openai && (x.openai.output || x.openai.output_text || x.openai.choices)) return x.openai;
  return x;
};

// OpenAI Responses API: Text extrahieren (robust)
const extractAssistantText = (resp0) => {
  const resp = unwrapResponse(resp0);
  if (!resp) return "";

  // 1) manche SDKs/Proxies geben output_text direkt
  if (typeof resp.output_text === "string" && resp.output_text.trim()) {
    return resp.output_text.trim();
  }

  // 2) Responses API: output -> message -> content -> output_text.text
  if (Array.isArray(resp.output)) {
    const chunks = [];
    for (const item of resp.output) {
      if (!item) continue;

      // content kann direkt am item hängen (je nach Format)
      const contentArr = Array.isArray(item.content) ? item.content : [];

      // üblich: type === "message"
      if (item.type === "message" && contentArr.length) {
        for (const c of contentArr) {
          if (!c) continue;
          if (c.type === "output_text" && typeof c.text === "string") chunks.push(c.text);
          if (c.type === "text" && typeof c.text === "string") chunks.push(c.text);
          if (c.type === "refusal" && typeof c.refusal === "string") chunks.push(c.refusal);
        }
        continue;
      }

      // fallback: wenn content direkt so aussieht wie output_text
      if (contentArr.length) {
        for (const c of contentArr) {
          if (!c) continue;
          if (typeof c.text === "string") chunks.push(c.text);
          if (typeof c.refusal === "string") chunks.push(c.refusal);
        }
      }
    }
    const joined = chunks.join("\n").trim();
    if (joined) return joined;
  }

  // 3) Chat Completions fallback (falls jemand doch /chat/completions nutzt)
  const cc = resp?.choices?.[0]?.message?.content;
  if (typeof cc === "string" && cc.trim()) return cc.trim();

  return "";
};

const ensureCompleted = (resp0) => {
  const resp = unwrapResponse(resp0);
  if (!resp) throw new Error("Keine Response erhalten.");

  if (resp.error) {
    const msg = resp.error?.message || JSON.stringify(resp.error);
    throw new Error(msg);
  }

  if (resp.status && resp.status !== "completed") {
    const details = resp.incomplete_details ? ` Details: ${JSON.stringify(resp.incomplete_details)}` : "";
    throw new Error(`OpenAI Response nicht abgeschlossen (status=${resp.status}).${details}`);
  }
};

// POST JSON helper
const postJson = async (url, body, headers = {}) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const msg = (json && json.error && (json.error.message || json.error)) || raw || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!json) {
    throw new Error("Antwort ist kein JSON. RAW: " + raw.slice(0, 400));
  }
  return json;
};

// JSON sicher aus output_text parsen
const tryParseJson = (text) => {
  const t = (text || "").trim();
  if (!t) throw new Error("Leere Antwort von ChatGPT (kein output_text gefunden).");
  try {
    return JSON.parse(t);
  } catch {
    // fallback: erstes {...} extrahieren
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("Antwort ist kein gültiges JSON.");
  }
};

// -------------------- Komponente --------------------
function KiPreisCard({ visible, currentRow, rankKeys = DEFAULT_RANK_KEYS, title = "KI-Preis" }) {
  const taRef = useRef(null);

  const [copyMsg, setCopyMsg] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [runMsg, setRunMsg] = useState("");

  const [preisVergleich, setPreisVergleich] = useState("");
  const [preisVergleichPlusKI, setPreisVergleichPlusKI] = useState("");
  const [begruendung, setBegruendung] = useState("");

  // optionaler Debug-Block (hilft bei “leer”)
  const [lastRawResponse, setLastRawResponse] = useState(null);
  const [lastExtractedText, setLastExtractedText] = useState("");

  const { prompt, unitForDisplay } = useMemo(() => {
    if (!currentRow) return { prompt: "Keine Daten geladen.", unitForDisplay: "" };

    const q = getQueryDetails(currentRow.Query || {});
    const qEinheit = toStr(q.einheit).trim();
    const unitHint = qEinheit ? `EUR/${qEinheit}` : "EUR";

    // Eingabeobjekt bewusst klein halten (Tokens sparen)
    const inputObj = {
      unit: qEinheit || null,
      query: {
        oz: toStr(q.oz).trim() || null,
        k: compactText(q.kurztext, 140) || null,
        t: compactText(q.langtext, 260) || null,
        m: parseNumberLoose(firstSemiValue(q.menge)),
      },
      comps: (rankKeys || []).map((rk) => {
        const d = getRankDetails(currentRow[rk] || {}, rk);
        return {
          r: rk,
          s: parseNumberLoose(firstSemiValue(d.score)), // score
          p: parseNumberLoose(firstSemiValue(d.preis)), // preis
          u: toStr(d.einheit).trim() || null,
          oz: toStr(d.oz).trim() || null,
          k: compactText(d.kurztext, 140) || null,
          t: compactText(d.langtext, 200) || null,
          m: parseNumberLoose(firstSemiValue(d.menge)),
        };
      }),
    };

    // TOKEN-OPTIMIERT: kurze Regeln + minified JSON
    // (Prompt = genau das, was später gesendet wird.)
    const p = [
      `Baukalkulator. Ziel: Einheitspreis für QUERY (${unitHint}).`,
      "Antworte als JSON mit: preis_comp (nur comps+scores), preis_ai (preis_comp + Fachwissen), begruendung (<=5 Sätze).",
      "Regel preis_comp: nutze nur comps mit p!=null. Wenn Scores (s) vorhanden und Σs>0: Σ(p*s)/Σs, sonst Mittelwert(p).",
      "INPUT=" + JSON.stringify(inputObj),
    ].join("\n");

    return { prompt: p, unitForDisplay: unitHint };
  }, [currentRow, rankKeys]);

  // Reset bei neuem Prompt
  useEffect(() => {
    setRunMsg("");
    setPreisVergleich("");
    setPreisVergleichPlusKI("");
    setBegruendung("");
    setLastRawResponse(null);
    setLastExtractedText("");
  }, [prompt]);

  const doLegacyCopy = () => {
    const ta = taRef.current;
    if (!ta) return false;
    ta.focus();
    ta.select();
    try {
      return !!document.execCommand("copy");
    } catch {
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
    } catch {
      // fallback
    }

    setCopyMsg(doLegacyCopy() ? "✅ Prompt kopiert." : "❌ Kopieren fehlgeschlagen (Browserrechte).");
  };

  const callOpenAI = async () => {
    // Wichtig: KEIN temperature (gpt-5-mini kann das ablehnen)
    const body = {
      model: GPT_MODEL,
      input: prompt, // exakt Prompt aus Textfeld
      reasoning: { effort: "low" }, // weniger Tokens/Latency
      max_output_tokens: 2050,
      text: {
        format: {
          type: "json_schema",
          name: "ki_preis_result",
          strict: true,
          schema: KI_PREIS_SCHEMA,
        },
      },
      store: false,
    };

    if (GPT_PROXY_URL) {
      return await postJson(GPT_PROXY_URL, body);
    }

    if (!GPT_KEY) {
      throw new Error(
        "Kein GPT_KEY gesetzt. Setze REACT_APP_OPENAI_API_KEY oder nutze REACT_APP_OPENAI_PROXY_URL (empfohlen)."
      );
    }

    return await postJson(OPENAI_RESPONSES_URL, body, {
      Authorization: `Bearer ${GPT_KEY}`,
    });
  };

  const onRun = async () => {
    setRunMsg("");
    if (!prompt || prompt === "Keine Daten geladen.") return;

    setRunBusy(true);
    try {
      const resp = await callOpenAI();

      // Debug speichern (hilft sofort bei Problemen)
      setLastRawResponse(resp);

      ensureCompleted(resp);

      const outText = extractAssistantText(resp);
      setLastExtractedText(outText || "");

      const obj = tryParseJson(outText);

      const unitLabel = unitForDisplay ? ` ${unitForDisplay}` : "";

      setPreisVergleich(
        typeof obj.preis_comp === "number"
          ? `${formatNumber2(obj.preis_comp)}${unitLabel}`
          : toStr(obj.preis_comp).trim()
      );

      setPreisVergleichPlusKI(
        typeof obj.preis_ai === "number"
          ? `${formatNumber2(obj.preis_ai)}${unitLabel}`
          : toStr(obj.preis_ai).trim()
      );

      setBegruendung(toStr(obj.begruendung).trim());
      setRunMsg("✅ Antwort erhalten.");
    } catch (e) {
      setRunMsg(`❌ ${e?.message || String(e)}`);
    } finally {
      setRunBusy(false);
    }
  };

  const canRun = !!prompt && prompt !== "Keine Daten geladen." && !runBusy;

  return (
    <div
      className={"rank-card ai-card " + (visible ? "visible" : "hidden")}
      style={{ borderStyle: "dashed", borderWidth: 2 }}
    >
      <div className="card-header" style={{ alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>{title}</span>
          <small style={{ opacity: 0.75 }}>Prompt aus Query + Rank1..3 (token-sparend)</small>
        </div>
      </div>

      <div className="card-body">
        <textarea
          ref={taRef}
          className="langtext-area"
          style={{ width: "100%", minHeight: 220, resize: "vertical" }}
          readOnly
          value={prompt}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 10,
            flexWrap: "wrap",
          }}
        >
          <button type="button" onClick={onCopy} disabled={!prompt || prompt === "Keine Daten geladen."}>
            Kopieren
          </button>

          <button type="button" onClick={onRun} disabled={!canRun}>
            {runBusy ? "..." : "Ausführen"}
          </button>

          <span style={{ fontSize: 13, opacity: 0.85 }}>{copyMsg}</span>
          <span style={{ fontSize: 13, opacity: 0.85 }}>{runMsg}</span>
        </div>

        {/* 3 Ergebnisfelder */}
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 4 }}>
              1) Preis nur aufgrund der Vergleichbaren Leistungen
            </div>
            <input
              type="text"
              readOnly
              value={preisVergleich}
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
              placeholder="(noch leer)"
            />
          </div>

          <div>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 4 }}>
              2) Preis aufgrund Vergleichbarer Leistungen + KI-Wissen
            </div>
            <input
              type="text"
              readOnly
              value={preisVergleichPlusKI}
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
              placeholder="(noch leer)"
            />
          </div>

          <div>
            <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 4 }}>
              3) Begründung des Unterschiedes
            </div>
            <textarea
              readOnly
              value={begruendung}
              style={{
                width: "100%",
                minHeight: 100,
                padding: 8,
                boxSizing: "border-box",
                resize: "vertical",
              }}
              placeholder="(noch leer)"
            />
          </div>
        </div>

        {/* Hinweis falls kein Key/Proxy */}
        {!GPT_PROXY_URL && !GPT_KEY ? (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
            Hinweis: Kein API-Key gesetzt. Setze <code>REACT_APP_OPENAI_API_KEY</code> oder nutze{" "}
            <code>REACT_APP_OPENAI_PROXY_URL</code> (empfohlen).
          </div>
        ) : null}

        {/* Debug (optional, aber extrem hilfreich bei “Leere Antwort…”) */}
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", opacity: 0.85 }}>Debug</summary>
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <div style={{ marginBottom: 6 }}>
              <b>Extracted output_text:</b>
              <pre style={{ whiteSpace: "pre-wrap" }}>{lastExtractedText || "(leer)"}</pre>
            </div>
            <div>
              <b>Raw Response JSON:</b>
              <pre style={{ whiteSpace: "pre-wrap" }}>
                {lastRawResponse ? JSON.stringify(lastRawResponse, null, 2) : "(noch keine Antwort)"}
              </pre>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

export default KiPreisCard;
