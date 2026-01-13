import React, { useEffect, useState, useCallback } from "react";
import "./styles.css";

const RANK_KEYS = ["Rank1", "Rank2", "Rank3"];

// Drei separate Webhooks
const WEBHOOK_WISSENSBASIS = "http://localhost:5678/webhook/3c03d899-1d40-4788-b4f1-f7fc9d281879";
const WEBHOOK_LV = "http://localhost:5678/webhook/60b65bb0-3f9d-4f1c-8f4f-aa982e5ea5b7";
const WEBHOOK_X84 = "http://localhost:5678/webhook/f12d2ee2-9885-4204-91e0-4b6d3fa0c2bf";



// Hilfsfunktion: Dateiname aus Content-Disposition lesen (für Downloads)
const parseDownloadFilename = (contentDisposition, fallback = "Anfrage1.X84") => {
  if (!contentDisposition) return fallback;

  // RFC 5987 / 6266: filename*=UTF-8''...
  const mStar = contentDisposition.match(/filename\*\s*=\s*([^;]+)/i);
  if (mStar && mStar[1]) {
    let v = mStar[1].trim();
    v = v.replace(/^"(.*)"$/, "$1");

    const parts = v.split("''"); // z.B. UTF-8''Anfrage1.X84
    if (parts.length === 2) {
      try {
        return (decodeURIComponent(parts[1]).split(/[\\/]/).pop() || fallback);
      } catch {
        return (parts[1].split(/[\\/]/).pop() || fallback);
      }
    }

    try {
      return (decodeURIComponent(v).split(/[\\/]/).pop() || fallback);
    } catch {
      return (v.split(/[\\/]/).pop() || fallback);
    }
  }

  // filename="..."
  const m = contentDisposition.match(/filename\s*=\s*([^;]+)/i);
  if (m && m[1]) {
    let v = m[1].trim();
    v = v.replace(/^"(.*)"$/, "$1");
    return (v.split(/[\\/]/).pop() || fallback);
  }

  return fallback;
};

function App() {
  const [data, setData] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeRankTab, setActiveRankTab] = useState("Rank1");
  const [selectionMap, setSelectionMap] = useState({});
  const [inputFileName, setInputFileName] = useState(null);
  const [status, setStatus] = useState("");

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

      // Hinweis: Wenn dein Frontend auf einer anderen Origin läuft als n8n,
      // ist Content-Disposition evtl. nur sichtbar, wenn n8n
      // "Access-Control-Expose-Headers: Content-Disposition" setzt.
      const contentType = (res.headers.get("Content-Type") || "").toLowerCase();

      // Falls n8n aus Versehen JSON zurückgibt, nicht als Datei downloaden
      if (contentType.includes("application/json")) {
        const txt = await res.text();
        setStatus(`Antwort war JSON (kein Download). Erste Zeichen: ${txt.slice(0, 300)}`);
        return;
      }

      // Datei-Download starten
      const blob = await res.blob();

      const cd =
        res.headers.get("Content-Disposition") ||
        res.headers.get("content-disposition") ||
        "";
      const outName = parseDownloadFilename(cd, "Anfrage1.X84");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = outName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);

      setStatus(`X84 erfolgreich generiert & heruntergeladen: ${outName}`);
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
          <button>Start</button>
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
          {status}
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