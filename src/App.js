import React, { useEffect, useState, useCallback } from "react";
import "./styles.css";

const RANK_KEYS = ["Rank1", "Rank2", "Rank3"];

// Drei separate Webhooks
const WEBHOOK_WISSENSBASIS = "http://localhost:5678/webhook/3c03d899-1d40-4788-b4f1-f7fc9d281879";
const WEBHOOK_LV = "http://localhost:5678/webhook/60b65bb0-3f9d-4f1c-8f4f-aa982e5ea5b7";
const WEBHOOK_X84 = "http://localhost:5678/webhook/f12d2ee2-9885-4204-91e0-4b6d3fa0c2bf";


// Big Workflow (asynchron: Start → Status Polling → Result)
// ⚠️ Passe WEBHOOK_BIG_START an deinen n8n Start-Webhook an (Hauptworkflow-Vergleich).
const WEBHOOK_BIG_START = "http://localhost:5678/webhook/bac5be33-1591-45ce-89b5-0d0514aa1a6e";

// Fallbacks für Status/Result, falls der Start-Webhook falsche URLs zurückliefert.
// Bei Webhooks mit Parametern hängt n8n oft eine UUID zwischen /webhook und deinem Pfad.
// Beispiel (bei dir per curl getestet):
//   http://localhost:5678/webhook/6a1d9532-6f66-48d4-8722-edaabbfd3115/job/status/206
const WEBHOOK_STATUS_BASE_FALLBACK =
  "http://localhost:5678/webhook/6a1d9532-6f66-48d4-8722-edaabbfd3115/job/status/";
const WEBHOOK_RESULT_BASE_FALLBACK =
  "http://localhost:5678/webhook/ffb126b7-6265-4461-aca4-02a9d06febeb/job/result/";

function App() {
  const [data, setData] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeRankTab, setActiveRankTab] = useState("Rank1");
  const [selectionMap, setSelectionMap] = useState({});
  const [inputFileName, setInputFileName] = useState(null);
  const [status, setStatus] = useState("");


// Big-Workflow Job State
const [jobRunning, setJobRunning] = useState(false);
const [jobId, setJobId] = useState(null);
const [jobStatusUrl, setJobStatusUrl] = useState("");
const [jobResultUrl, setJobResultUrl] = useState("");
const [jobProgress, setJobProgress] = useState(null);
const [jobStatusObj, setJobStatusObj] = useState("");
const [jobError, setJobError] = useState("");

  // Upload-Projekt Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [kbFiles, setKbFiles] = useState([]);
  const [lvFiles, setLvFiles] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  const currentRow = data[currentIndex] || null;

  useEffect(() => {
    setActiveRankTab("Rank1");
  }, [currentIndex]);

  useEffect(() => {
    if (!showUploadModal) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setShowUploadModal(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showUploadModal]);

  // ---------- Hilfsfunktionen ----------
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

  const padToSix = (arr) => {
    const out = Array.isArray(arr) ? arr.slice(0, 6) : [];
    while (out.length < 6) out.push("");
    return out;
  };

  const formatNumber2 = (v) => {
    const s0 = toStr(v).trim();
    if (s0 === "") return "";
    if (s0 === "---") return "---";

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

    return n.toFixed(2).replace(".", ",");
  };

  const firstSemiValue = (v) => {
    const a = splitSemi(v);
    if (a.length) return a[0];
    return toStr(v).trim();
  };

  const buildSixCols = ({
    raw,
    sourcesRaw = "",
    placeholder = "",
    formatter = (x) => x,
    replicateSingleToSources = false,
  }) => {
    const sources = splitSemi(sourcesRaw);
    const vals = splitSemi(raw);

    let out = [];
    if (vals.length === 0) {
      out = placeholder ? [placeholder] : [];
    } else if (replicateSingleToSources && vals.length === 1 && sources.length > 1) {
      const n = Math.min(sources.length, 6);
      out = Array.from({ length: n }, () => vals[0]);
    } else {
      out = vals.slice(0, 6);
    }

    return padToSix(out.map((x) => formatter(x)));
  };

  // .json Erweiterung von Dateinamen entfernen
  const removeJsonExt = (filename) => {
    if (!filename) return filename;
    return String(filename).replace(/\.json$/i, "");
  };


// ---------- Big Workflow Helper ----------
const safeJsonParse = (text) => {
  if (text === null || text === undefined) return null;
  const t = String(text).trim();
  if (!t) return null;
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
};

const readResponseAsJsonOrText = async (res) => {
  const txt = await res.text();
  return safeJsonParse(txt);
};

// n8n antwortet je nach Node manchmal als {data:[...]} Wrapper
const unwrapN8nData = (payload) => {
  if (payload && typeof payload === "object" && Array.isArray(payload.data)) {
    // Bei Status: [{StatusObj, progress}]  |  Bei Result: [rows...]
    return payload.data;
  }
  return payload;
};

const normalizeJobUrls = ({ id, statusUrl, resultUrl }) => {
  const sid = String(id ?? "").trim();

  let sUrl = String(statusUrl ?? "").trim();
  let rUrl = String(resultUrl ?? "").trim();

  // Wenn Start-Webhook fälschlich /webhook/job/status/... liefert, reparieren.
  if (sUrl.includes("/webhook/job/status/") || !sUrl) {
    sUrl = WEBHOOK_STATUS_BASE_FALLBACK + sid;
  }
  if (rUrl.includes("/webhook/job/result/") || !rUrl) {
    rUrl = WEBHOOK_RESULT_BASE_FALLBACK + sid;
  }

  return { sUrl, rUrl };
};

const downloadJsonBlob = (obj, filename = "result.json") => {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

  const formatSemiNumberField = (raw, { placeholder = "" } = {}) => {
    const parts = splitSemi(raw);
    if (!parts.length) return placeholder;
    return parts.map((x) => formatNumber2(x)).join("; ");
  };

  const QUERY_PREIS_KEYS = [
    "query-preis",
    "query_preis",
    "preis",
    "unit_price",
    "unitPrice",
  ];

  const getQueryPreisValue = (queryObj) => {
    if (!queryObj) return "";
    return toStr(pickFirst(queryObj, QUERY_PREIS_KEYS));
  };

  const setQueryPreisForIndex = (idx, preisStr) => {
    setData((prev) => {
      if (!Array.isArray(prev) || idx < 0 || idx >= prev.length) return prev;
      return prev.map((row, i) => {
        if (i !== idx) return row;
        const q = row?.Query || {};

        const existingKey = QUERY_PREIS_KEYS.find((k) =>
          Object.prototype.hasOwnProperty.call(q, k)
        );
        const keyToUse = existingKey || "query-preis";

        const normalized = toStr(preisStr);
        const newValue = isBlank(normalized) ? null : normalized;

        return {
          ...row,
          Query: {
            ...q,
            [keyToUse]: newValue,
          },
        };
      });
    });
  };

  // ---------- Datei laden ----------
  const handleFileChange = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const file = files[0];
    const text = await file.text();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error("Fehler beim Parsen von JSON:", e);
      setStatus("Fehler: Datei ist kein gültiges JSON.");
      return;
    }

    if (!Array.isArray(parsed)) {
      setStatus("Fehler: JSON muss ein Array sein (z.B. [{Query, Rank1,...}, ...]).");
      return;
    }

    const newSel = {};
    parsed.forEach((row, idx) => {
      if (
        row &&
        typeof row.selectedRankKey === "string" &&
        RANK_KEYS.includes(row.selectedRankKey)
      ) {
        newSel[idx] = row.selectedRankKey;
      }
    });

    setData(parsed);
    setSelectionMap(newSel);
    setInputFileName(file.name);
    setCurrentIndex(0);
    setActiveRankTab("Rank1");
    setStatus(`Input geladen (${parsed.length} Zeilen).`);
  };

  // ---------- Auswahl setzen ----------
  const setSelectionForCurrent = (rankKey) => {
    if (!currentRow) return;

    setSelectionMap((prev) => ({
      ...prev,
      [currentIndex]: rankKey,
    }));

    const rankObj = currentRow?.[rankKey] || {};
    const prefix = (rankKey || "").toLowerCase();
    const rankPreisRaw = pickFirst(rankObj, [
      `${prefix}-preis`,
      `${prefix}_preis`,
      "preis",
      "unit_price",
      "unitPrice",
    ]);
    const firstPreis = firstSemiValue(rankPreisRaw);
    const formattedFirst = isBlank(firstPreis) ? "" : formatNumber2(firstPreis);
    setQueryPreisForIndex(currentIndex, formattedFirst);
  };

  // ---------- Speichern ----------
  const saveSelection = useCallback(() => {
    if (!data || data.length === 0) {
      setStatus("Keine Daten zum Speichern.");
      return;
    }

    const output = data.map((row, idx) => ({
      ...row,
      selectedRankKey: selectionMap[idx] || null,
    }));

    const base =
      (inputFileName && inputFileName.replace(/\.json$/i, "")) ||
      "selection";
    const outName = `${base}-selection.json`;

    const blob = new Blob([JSON.stringify(output, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = outName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setStatus(
      `JSON mit selectedRankKey (und ggf. Einheitspreis in der Query) als ${outName} zum Download bereitgestellt.`
    );
  }, [data, selectionMap, inputFileName]);

  const formatPreis = (v) => (v === undefined || v === null || isBlank(v) ? "---" : toStr(v));

  // ---------- Details-Renderer ----------
  const renderDetailsTable = (rows) => {
    return (
      <table className="kv-table details-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>
                {r.type === "textarea" ? (
                  <textarea
                    className="langtext-area"
                    rows={4}
                    readOnly
                    value={toStr(r.value)}
                  />
                ) : r.type === "six" ? (
                  <div
                    className={
                      "six-grid " + (r.sixKind === "number" ? "six-number" : "six-text")
                    }
                  >
                    {padToSix(r.values || []).map((v, i) => (
                      <div key={i} className="six-cell">
                        {toStr(v)}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="value-text">{toStr(r.value)}</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
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
    };
  };

  const renderQueryDetails = (queryObj) => {
    if (!queryObj) return <div className="empty">Keine Daten</div>;
    const d = getQueryDetails(queryObj);

    const mengeOneField = formatSemiNumberField(d.menge);
    const preisOneField = formatSemiNumberField(d.preis, { placeholder: "---" });

    return renderDetailsTable([
      { label: "Pfad", value: d.path },
      { label: "OZ", value: d.oz },
      { label: "Kurztext", value: d.kurztext },
      { label: "Langtext", value: d.langtext, type: "textarea" },
      { label: "Menge(n)", value: mengeOneField },
      { label: "Einheit", value: d.einheit },
      { label: "Einheitspreis in Euro", value: preisOneField },
    ]);
  };

  const renderRankDetails = (rankObj, rankKey) => {
    if (!rankObj) return <div className="empty">Keine Daten</div>;
    const d = getRankDetails(rankObj, rankKey);

    const ozCols = buildSixCols({
      raw: d.oz,
      formatter: (x) => toStr(x),
    });

    const mengeCols = buildSixCols({
      raw: d.menge,
      sourcesRaw: d.quellen,
      replicateSingleToSources: true,
      formatter: formatNumber2,
    });
    const preisCols = buildSixCols({
      raw: d.preis,
      sourcesRaw: d.quellen,
      replicateSingleToSources: true,
      formatter: formatNumber2,
      placeholder: "---",
    });
    const quellenCols = buildSixCols({
      raw: d.quellen,
      formatter: (x) => removeJsonExt(toStr(x)),
    });

    return renderDetailsTable([
      { label: "Pfad", value: d.path },
      { label: "Kurztext", value: d.kurztext },
      { label: "Langtext", value: d.langtext, type: "textarea" },
      { label: "Quellen", type: "six", values: quellenCols, sixKind: "text" },
      { label: "OZ", type: "six", values: ozCols, sixKind: "text" },
      { label: "Menge(n)", type: "six", values: mengeCols, sixKind: "number" },
      { label: "Einheit", value: d.einheit },
      { label: "Einheitspreis in Euro", type: "six", values: preisCols, sixKind: "number" },
    ]);
  };

  const getQueryPreview = (row) => {
    const q = row?.Query || {};
    const mengeRaw = pickFirst(q, ["query-menge", "query_menge", "queryMenge"]);
    const mengeFirst = firstSemiValue(mengeRaw);
    return {
      oz: pickFirst(q, ["query-oz", "query_oz", "oz"]),
      kurztext: pickFirst(q, ["query-kurztext", "query_kurztext", "queryKurztext"]),
      einheit: pickFirst(q, ["query-einheit", "query_einheit", "queryEinheit"]),
      menge: isBlank(mengeFirst) ? "" : formatNumber2(mengeFirst),
    };
  };

  const openUploadModal = () => {
    setKbFiles([]);
    setLvFiles([]);
    setUploadMessage("");
    setShowUploadModal(true);
  };

  const closeUploadModal = () => {
    if (uploadBusy) return;
    setShowUploadModal(false);
  };

  const uploadProjekt = async () => {
    if (uploadBusy) return;
    if (!kbFiles.length || !lvFiles.length) {
      setUploadMessage("Bitte wähle in beiden Bereichen mindestens eine Datei aus.");
      return;
    }

    setUploadBusy(true);
    setUploadMessage("");

    try {
      // 1. Wissensbasis-Dateien zum ersten Webhook senden
      const fdKb = new FormData();
      kbFiles.forEach((f) => fdKb.append("data", f, f.name));

      const resKb = await fetch(WEBHOOK_WISSENSBASIS, {
        method: "POST",
        body: fdKb,
      });

      if (!resKb.ok) {
        const rawKb = await resKb.text();
        throw new Error(`Wissensbasis-Upload fehlgeschlagen: ${rawKb || `HTTP ${resKb.status}`}`);
      }

      // 2. LV-Dateien zum zweiten Webhook senden
      const fdLv = new FormData();
      lvFiles.forEach((f) => fdLv.append("data", f, f.name));

      const resLv = await fetch(WEBHOOK_LV, {
        method: "POST",
        body: fdLv,
      });

      if (!resLv.ok) {
        const rawLv = await resLv.text();
        throw new Error(`LV-Upload fehlgeschlagen: ${rawLv || `HTTP ${resLv.status}`}`);
      }

      setStatus(
        `Upload abgeschlossen: ${kbFiles.length} Wissensbasis-Datei(en), ${lvFiles.length} LV-Datei(en).`
      );
      setShowUploadModal(false);
    } catch (e) {
      console.error(e);
      setUploadMessage(`Fehler beim Upload: ${e?.message || String(e)}`);
    } finally {
      setUploadBusy(false);
    }
  };


// ---------- Big Workflow Start + Polling ----------
const startBigWorkflow = async () => {
  if (jobRunning) return;

  setJobError("");
  setJobStatusObj("");
  setJobProgress(null);

  setStatus("Workflow wird gestartet...");
  setJobRunning(true);

  try {
    // POST ohne Body -> kein CORS Preflight (meist stabiler)
    const res = await fetch(WEBHOOK_BIG_START, { method: "POST" });

    if (!res.ok) {
      const raw = await res.text();
      throw new Error(raw || `HTTP ${res.status}`);
    }

    let payload = await readResponseAsJsonOrText(res);

    // Falls n8n eine JSON-String-Literal zurückgibt: nochmals parsen
    if (typeof payload === "string") {
      const p2 = safeJsonParse(payload);
      if (p2 && typeof p2 === "object") payload = p2;
    }

    const jobIdFromPayload = payload?.jobId ?? payload?.id ?? payload?.executionId ?? null;
    if (jobIdFromPayload === null || jobIdFromPayload === undefined || jobIdFromPayload === "") {
      throw new Error("Start-Antwort enthält keine jobId.");
    }

    const id = String(jobIdFromPayload);
    const { sUrl, rUrl } = normalizeJobUrls({
      id,
      statusUrl: payload?.statusUrl,
      resultUrl: payload?.resultUrl,
    });

    setJobId(id);
    setJobStatusUrl(sUrl);
    setJobResultUrl(rUrl);

    setStatus(`Workflow gestartet. JobId=${id}. Warte auf Status...`);
  } catch (e) {
    console.error(e);
    setJobError(e?.message || String(e));
    setStatus(`Fehler beim Start: ${e?.message || String(e)}`);
    setJobRunning(false);
  }
};

// Polling: sobald jobRunning + jobStatusUrl gesetzt ist
useEffect(() => {
  if (!jobRunning || !jobId || !jobStatusUrl) return;

  let cancelled = false;
  const ac = new AbortController();

  const pollOnce = async () => {
    try {
      const res = await fetch(jobStatusUrl, { method: "GET", signal: ac.signal });

      if (!res.ok) {
        const raw = await res.text();
        throw new Error(raw || `HTTP ${res.status}`);
      }

      const payload = await readResponseAsJsonOrText(res);
      const unwrapped = unwrapN8nData(payload);

      // Status-Workflow liefert i.d.R. {data:[{StatusObj, progress}]}
      let statusObj = "";
      let progress = null;

      if (Array.isArray(unwrapped) && unwrapped.length > 0 && typeof unwrapped[0] === "object") {
        statusObj = unwrapped[0]?.StatusObj ?? unwrapped[0]?.status ?? "";
        progress = unwrapped[0]?.progress ?? null;
      } else if (unwrapped && typeof unwrapped === "object") {
        statusObj = unwrapped?.StatusObj ?? unwrapped?.status ?? "";
        progress = unwrapped?.progress ?? null;
      }

      if (!cancelled) {
        setJobStatusObj(String(statusObj || ""));
        setJobProgress(progress);

        const pTxt = progress === null || progress === undefined ? "" : ` (${progress}%)`;
        setStatus(`Job ${jobId}: ${statusObj || "läuft..."}${pTxt}`);
      }

      const done =
        String(statusObj || "").toLowerCase() === "done" ||
        String(statusObj || "").toLowerCase() === "finished" ||
        (typeof progress === "number" && progress >= 100) ||
        String(progress) === "100";

      if (done) {
        // Result holen + in App laden + Download anbieten
        const res2 = await fetch(jobResultUrl, { method: "GET", signal: ac.signal });

        if (!res2.ok) {
          const raw2 = await res2.text();
          throw new Error(raw2 || `HTTP ${res2.status}`);
        }

        const payload2 = await readResponseAsJsonOrText(res2);
        const resultUnwrapped = unwrapN8nData(payload2);

        // In der App laden (gleiche Logik wie Open JSON)
        let rows = [];
        if (Array.isArray(resultUnwrapped)) {
          rows = resultUnwrapped;
        } else if (resultUnwrapped && typeof resultUnwrapped === "object") {
          // Falls result nur ein Objekt ist, als 1-Zeiler anzeigen
          rows = [resultUnwrapped];
        }

        // selectionMap aus evtl. selectedRankKey übernehmen
        const newSel = {};
        rows.forEach((row, idx) => {
          if (
            row &&
            typeof row.selectedRankKey === "string" &&
            RANK_KEYS.includes(row.selectedRankKey)
          ) {
            newSel[idx] = row.selectedRankKey;
          }
        });

        if (!cancelled) {
          setData(rows);
          setSelectionMap(newSel);
          setInputFileName(`job-${jobId}-result.json`);
          setCurrentIndex(0);
          setActiveRankTab("Rank1");

          setStatus(`Job ${jobId}: done (100%). Ergebnis geladen (${rows.length} Zeilen).`);

          // Automatisch JSON herunterladen (so wie du es wolltest)
          downloadJsonBlob(rows, `match_report_job-${jobId}.json`);
        }

        if (!cancelled) setJobRunning(false);
        return;
      }

      // Nächster Poll
      if (!cancelled) setTimeout(pollOnce, 1200);
    } catch (e) {
      if (cancelled) return;
      console.error(e);
      setJobError(e?.message || String(e));
      setStatus(`Polling Fehler (Job ${jobId}): ${e?.message || String(e)}`);
      setJobRunning(false);
    }
  };

  pollOnce();

  return () => {
    cancelled = true;
    ac.abort();
  };
}, [jobRunning, jobId, jobStatusUrl, jobResultUrl]);  

  const generiereX84 = async () => {
    if (!data || data.length === 0) {
      setStatus("Keine Daten zum Generieren.");
      return;
    }

    try {
      // Aktuelle Daten mit selectedRankKey vorbereiten
      const output = data.map((row, idx) => ({
        ...row,
        selectedRankKey: selectionMap[idx] || null,
      }));

      // JSON als Blob erstellen
      const jsonBlob = new Blob([JSON.stringify(output, null, 2)], {
        type: "application/json",
      });

      // FormData für Upload
      const fd = new FormData();
      const filename = inputFileName || "data.json";
      fd.append("data", jsonBlob, filename);

      setStatus("X84 wird generiert...");

      const res = await fetch(WEBHOOK_X84, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const rawRes = await res.text();
        throw new Error(`X84-Generierung fehlgeschlagen: ${rawRes || `HTTP ${res.status}`}`);
      }

      setStatus("X84 erfolgreich generiert!");
    } catch (e) {
      console.error(e);
      setStatus(`Fehler bei X84-Generierung: ${e?.message || String(e)}`);
    }
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
          <button onClick={openUploadModal}>Upload Projekt</button>
          <button onClick={startBigWorkflow} disabled={jobRunning}>Start</button>
          <button
            onClick={() => {
              const input = document.getElementById("file-input");
              if (input) input.click();
            }}
          >
            Open JSON
          </button>
          <input
            id="file-input"
            type="file"
            accept=".json,application/json"
            multiple={false}
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button onClick={saveSelection} disabled={!data.length}>
            Save (…-selection.json)
          </button>
          <button onClick={generiereX84} disabled={!data.length}>
            Generiere X84
          </button>
        </div>

<div className="status">
  <div>{status}</div>
  {jobRunning && (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 12, opacity: 0.8 }}>
        {jobStatusObj ? `Status: ${jobStatusObj}` : "Status: ..."}{jobProgress !== null && jobProgress !== undefined ? ` | Fortschritt: ${jobProgress}%` : ""}
      </div>
      <div style={{ height: 8, border: "1px solid #d1d5db", borderRadius: 6, overflow: "hidden", marginTop: 4 }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, Math.min(100, Number(jobProgress ?? 0)))}%`,
            background: "#111827",
          }}
        />
      </div>
    </div>
  )}
  {!jobRunning && jobError ? (
    <div style={{ marginTop: 6, fontSize: 12, color: "#b91c1c" }}>
      {jobError}
    </div>
  ) : null}
</div>
      </header>

      {showUploadModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="upload-modal-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeUploadModal();
          }}
        >
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 id="upload-modal-title">Upload Projekt</h3>
              <button
                className="modal-close"
                onClick={closeUploadModal}
                aria-label="Schließen"
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="file-widget">
                <div className="file-widget-title">Wissensbasis</div>
                <input
                  type="file"
                  multiple
                  onChange={(e) => setKbFiles(Array.from(e.target.files || []))}
                />
                {kbFiles.length > 0 ? (
                  <ul className="file-list">
                    {kbFiles.map((f) => (
                      <li key={f.name + f.size}>{f.name}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="file-widget">
                <div className="file-widget-title">LV zu bepreisen</div>
                <input
                  type="file"
                  multiple
                  onChange={(e) => setLvFiles(Array.from(e.target.files || []))}
                />
                {lvFiles.length > 0 ? (
                  <ul className="file-list">
                    {lvFiles.map((f) => (
                      <li key={f.name + f.size}>{f.name}</li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <div className="upload-hint">
                Wissensbasis → <span className="mono">{WEBHOOK_WISSENSBASIS}</span>
                <br />
                LV zu bepreisen → <span className="mono">{WEBHOOK_LV}</span>
              </div>

              {uploadMessage ? (
                <div className="upload-msg">{uploadMessage}</div>
              ) : null}
            </div>

            <div className="modal-footer">
              <button onClick={closeUploadModal} disabled={uploadBusy}>
                Abbrechen
              </button>
              <button
                onClick={uploadProjekt}
                disabled={
                  uploadBusy || kbFiles.length === 0 || lvFiles.length === 0
                }
              >
                {uploadBusy ? "Upload läuft..." : "Hochladen"}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="app-main" style={{ display: "flex", flexDirection: "row", flexWrap: "nowrap", flex: 1, overflow: "hidden" }}>
        <section
          className="left-panel"
          style={{ flex: "0 0 40%", minWidth: 0, borderRight: "1px solid #e5e7eb", padding: 12, boxSizing: "border-box", display: "flex", flexDirection: "column" }}
        >
          <div className="left-title-row">
            <h2>LV zu bepreisen</h2>
            <div className="unitprice-inline" aria-label="Einheitspreis Eingabe">
              <span className="unitprice-label">Einheitspreis in Euro</span>
              <input
                className="unitprice-input"
                type="text"
                inputMode="decimal"
                value={currentRow ? getQueryPreisValue(currentRow.Query) : ""}
                onChange={(e) => setQueryPreisForIndex(currentIndex, e.target.value)}
                placeholder=""
              />
            </div>
          </div>
          <div className="row-info">
            Zeile {data.length ? currentIndex + 1 : 0} / {data.length}
          </div>

          <div className="query-table-wrapper" aria-label="Query Liste">
            <table className="query-table">
              <colgroup>
                <col style={{ width: "18%" }} />
                <col style={{ width: "52%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "18%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>OZ</th>
                  <th>Kurztext</th>
                  <th>Einheit</th>
                  <th>Menge</th>
                </tr>
              </thead>
              <tbody>
                {data.length ? (
                  data.map((row, idx) => {
                    const p = getQueryPreview(row);
                    const selected = idx === currentIndex;
                    return (
                      <tr
                        key={idx}
                        className={"query-row " + (selected ? "selected" : "")}
                        onClick={() => setCurrentIndex(idx)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setCurrentIndex(idx);
                          }
                        }}
                        title={p.kurztext ? String(p.kurztext) : ""}
                      >
                        <td>{p.oz}</td>
                        <td className="ellipsis">{p.kurztext}</td>
                        <td>{p.einheit}</td>
                        <td>{p.menge}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="empty-cell" colSpan={4}>
                      Keine Daten geladen.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="panel-content">
            {currentRow ? (
              renderQueryDetails(currentRow.Query)
            ) : (
              <div className="empty">Keine Daten geladen.</div>
            )}
          </div>
        </section>

        <section
          className="right-panel"
          style={{ flex: "1 1 auto", minWidth: 0, padding: 12, boxSizing: "border-box", display: "flex", flexDirection: "column" }}
        >
          <h2>Vorschläge</h2>
          <div className="tab-bar">
            {RANK_KEYS.map((rk) => (
              <button
                key={rk}
                className={
                  "tab-btn " + (activeRankTab === rk ? "active" : "")
                }
                onClick={() => setActiveRankTab(rk)}
              >
                {rk}
              </button>
            ))}
          </div>

          <div className="card-container">
            {RANK_KEYS.map((rk) => {
              const visible = activeRankTab === rk;
              const selected = selectionMap[currentIndex] === rk;
              const obj = currentRow ? currentRow[rk] : null;
              return (
                <div
                  key={rk}
                  className={
                    "rank-card " + (visible ? "visible" : "hidden")
                  }
                >
                  <div className="card-header">
                    <span>{rk}</span>
                    <label className="select-label">
                      <input
                        type="radio"
                        name={`rank-select-${currentIndex}`}
                        checked={selected}
                        onChange={() => setSelectionForCurrent(rk)}
                      />
                      Diesen Rank wählen
                    </label>
                  </div>
                  <div className="card-body">
                    {renderRankDetails(obj, rk)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;