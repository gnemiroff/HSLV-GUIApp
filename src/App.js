import React, { useEffect, useState, useCallback } from "react";
import "./styles.css";

const RANK_KEYS = ["Rank1", "Rank2", "Rank3"];

const WEBHOOK_URL = "http://localhost:5678/webhook/3c03d899-1d40-4788-b4f1-f7fc9d281879";

function App() {
  const [data, setData] = useState([]);               // [{Query, Rank1, Rank2, Rank3, selectedRankKey?}, ...]
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeRankTab, setActiveRankTab] = useState("Rank1");
  const [selectionMap, setSelectionMap] = useState({}); // index -> "Rank1"|"Rank2"|"Rank3"
  const [inputFileName, setInputFileName] = useState(null);
  const [status, setStatus] = useState("");

  // Upload-Projekt Modal
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [kbFiles, setKbFiles] = useState([]);
  const [lvFiles, setLvFiles] = useState([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");

  const currentRow = data[currentIndex] || null;

  // Wenn der Nutzer links in der Tabelle auf eine andere Zeile springt,
  // soll rechts standardmäßig wieder Rank1 angezeigt werden.
  useEffect(() => {
    setActiveRankTab("Rank1");
  }, [currentIndex]);

  // Modal per ESC schließen
  useEffect(() => {
    if (!showUploadModal) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setShowUploadModal(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showUploadModal]);

  // ---------- Hilfsfunktionen: Werte robust aus JSON ziehen ----------
  const toStr = (v) => (v === null || v === undefined ? "" : String(v));
  const isBlank = (v) => toStr(v).trim() === "";

  const pickFirst = (obj, keys) => {
    for (const k of keys) {
      if (!obj) continue;
      const v = obj[k];
      // "0" soll als gültiger Wert durchgehen
      if (v !== undefined && v !== null && !isBlank(v)) return v;
    }
    return "";
  };

  // Semikolon-getrennte Werte als Array (trim + leere Einträge raus)
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

  // Zahl (de/en) robust auf 2 Nachkommastellen formatieren.
  // - Akzeptiert z.B. "12", "12,3", "12.3", "1.234,56"
  // - Wenn es keine "saubere" Zahl ist, wird der Original-String zurückgegeben.
  const formatNumber2 = (v) => {
    const s0 = toStr(v).trim();
    if (s0 === "") return "";
    if (s0 === "---") return "---";

    let s = s0.replace(/\s/g, "");
    if (s.includes(",") && s.includes(".")) {
      // typisch deutsch: 1.234,56
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (s.includes(",")) {
      // deutsch ohne Tausenderpunkte
      s = s.replace(",", ".");
    }
    if (s.startsWith("+")) s = s.slice(1);

    // Nur echte Zahlen akzeptieren (verhindert z.B. "1-2" -> 1)
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

  // Semikolon-getrennte Zahlen (oder Zahlstrings) als *ein* Feld formatieren
  // (links: keine 6-Spalten-Darstellung für Menge(n) und Einheitspreis).
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
    // Hier bewusst NICHT formatPreis("---"), weil das Eingabefeld leer starten soll
    return toStr(pickFirst(queryObj, QUERY_PREIS_KEYS));
  };

  const setQueryPreisForIndex = (idx, preisStr) => {
    setData((prev) => {
      if (!Array.isArray(prev) || idx < 0 || idx >= prev.length) return prev;
      return prev.map((row, i) => {
        if (i !== idx) return row;
        const q = row?.Query || {};

        // Wenn schon ein Preis-Key existiert, verwende diesen, sonst "query-preis".
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

    const file = files[0]; // wir nehmen die erste gewählte JSON-Datei
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

    // Selections aus selectedRankKey übernehmen
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

    // 1) Auswahl (Rank1/2/3) speichern
    setSelectionMap((prev) => ({
      ...prev,
      [currentIndex]: rankKey,
    }));

    // 2) Einheitspreis der Query automatisch mit dem gewählten Rank-Preis befüllen
    //    (damit beim Speichern auch wirklich ein Preis in der Query steht).
    const rankObj = currentRow?.[rankKey] || {};
    const prefix = (rankKey || "").toLowerCase(); // "Rank1" -> "rank1"
    const rankPreisRaw = pickFirst(rankObj, [
      `${prefix}-preis`,
      `${prefix}_preis`,
      "preis",
      "unit_price",
      "unitPrice",
    ]);
    // Gewünscht: Einheitspreis aus der *ersten Spalte* übernehmen
    const firstPreis = firstSemiValue(rankPreisRaw);
    const formattedFirst = isBlank(firstPreis) ? "" : formatNumber2(firstPreis);
    setQueryPreisForIndex(currentIndex, formattedFirst);
  };

  // ---------- Speichern: JSON mit selectedRankKey ----------
  const saveSelection = useCallback(() => {
    if (!data || data.length === 0) {
      setStatus("Keine Daten zum Speichern.");
      return;
    }

    const output = data.map((row, idx) => ({
      ...row,
      selectedRankKey: selectionMap[idx] || null, // null = nichts gewählt
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

  // ---------- Details-Renderer (Query & Ranks) ----------
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
    const prefix = (rankKey || "").toLowerCase(); // "Rank1" -> "rank1"

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

    // Links: Menge(n) und Einheitspreis *ohne* 6-Spalten-Layout, aber sauber auf 2 Nachkommastellen.
    const mengeOneField = formatSemiNumberField(d.menge);
    const preisOneField = formatSemiNumberField(d.preis, { placeholder: "---" });

    return renderDetailsTable([
      { label: "Pfad", value: d.path },
      // Links soll OZ wie früher als einzelnes Feld ganz oben stehen.
      { label: "OZ", value: d.oz },
      { label: "Kurztext", value: d.kurztext },
      { label: "Langtext", value: d.langtext, type: "textarea" },
      { label: "Einheit", value: d.einheit },
      { label: "Menge(n)", value: mengeOneField },
      { label: "Einheitspreis", value: preisOneField },
    ]);
  };

  const renderRankDetails = (rankObj, rankKey) => {
    if (!rankObj) return <div className="empty">Keine Daten</div>;
    const d = getRankDetails(rankObj, rankKey);

    // Rechts: OZ soll in die 6-spaltige Darstellung (wie Menge/Einheitspreis/Quellen)
    const ozCols = buildSixCols({
      raw: d.oz,
      // bewusst keine Replikation wie bei Menge/Preis – OZ ist i.d.R. ein Code,
      // falls nur 1 Wert vorhanden ist, bleiben die restlichen Spalten leer.
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
      formatter: (x) => toStr(x),
    });

    return renderDetailsTable([
      { label: "Pfad", value: d.path },
      { label: "Kurztext", value: d.kurztext },
      { label: "Langtext", value: d.langtext, type: "textarea" },
      { label: "Quellen", type: "six", values: quellenCols, sixKind: "text" },
      { label: "OZ", type: "six", values: ozCols, sixKind: "text" },
      { label: "Menge(n)", type: "six", values: mengeCols, sixKind: "number" },
      { label: "Einheitspreis", type: "six", values: preisCols, sixKind: "number" },
      { label: "Einheit", value: d.einheit },

    ]);
  };

  // ---------- Query-Tabelle (links oben) ----------

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
      const fd = new FormData();
      // Reihenfolge ist relevant: erst Wissensbasis, dann LV zu bepreisen.
      [...kbFiles, ...lvFiles].forEach((f) => fd.append("data", f, f.name));

      const res = await fetch(WEBHOOK_URL, {
        method: "POST",
        body: fd,
      });

      const raw = await res.text();
      let preview = raw;
      try {
        const json = JSON.parse(raw);
        preview = JSON.stringify(json);
      } catch (_) {}

      if (!res.ok) {
        throw new Error(preview || `HTTP ${res.status}`);
      }

      setStatus(`Upload abgeschlossen (${kbFiles.length + lvFiles.length} Datei(en)).`);
      setShowUploadModal(false);
    } catch (e) {
      console.error(e);
      setUploadMessage(`Fehler beim Upload: ${e?.message || String(e)}`);
    } finally {
      setUploadBusy(false);
    }
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
          <button onClick={openUploadModal}>Upload Projekt</button>
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
                Webhook: <span className="mono">{WEBHOOK_URL}</span>
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

      {/* Inline-Fallbacks, damit die 2-Spalten-Aufteilung auch dann hält,
          wenn Styles aus irgendeinem Grund nicht greifen sollten. */}
      <main className="app-main" style={{ display: "flex", flexDirection: "row", flexWrap: "nowrap", flex: 1, overflow: "hidden" }}>
        {/* Linke Seite: Query */}
        <section
          className="left-panel"
          style={{ flex: "0 0 40%", minWidth: 0, borderRight: "1px solid #e5e7eb", padding: 12, boxSizing: "border-box", display: "flex", flexDirection: "column" }}
        >
          <div className="left-title-row">
            <h2>Zu bepreisende LV</h2>
            <div className="unitprice-inline" aria-label="Einheitspreis Eingabe">
              <span className="unitprice-label">Einheitspreis</span>
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

          {/* Scrollbare Tabelle: zeigt immer nur einen Ausschnitt (z.B. 5 Zeilen) */}
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

        {/* Rechte Seite: Rank-Karten */}
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
