import React, { useState, useCallback } from "react";
import "./styles.css";

const RANK_KEYS = ["Rank1", "Rank2", "Rank3"];

function App() {
  const [data, setData] = useState([]);               // [{Query, Rank1, Rank2, Rank3, selectedRankKey?}, ...]
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeRankTab, setActiveRankTab] = useState("Rank1");
  const [selectionMap, setSelectionMap] = useState({}); // index -> "Rank1"|"Rank2"|"Rank3"
  const [inputFileName, setInputFileName] = useState(null);
  const [status, setStatus] = useState("");

  const currentRow = data[currentIndex] || null;

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
    setSelectionMap((prev) => ({
      ...prev,
      [currentIndex]: rankKey,
    }));
  };

  // ---------- Navigation ----------
  const goPrev = () => {
    setCurrentIndex((idx) => Math.max(0, idx - 1));
  };
  const goNext = () => {
    setCurrentIndex((idx) =>
      Math.min(data.length - 1, idx + 1)
    );
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

    setStatus(`JSON mit selectedRankKey als ${outName} zum Download bereitgestellt.`);
  }, [data, selectionMap, inputFileName]);

  // ---------- Rendering Hilfsfunktion ----------
  const renderObjectFields = (obj) => {
    if (!obj) return <div className="empty">Keine Daten</div>;
    const entries = Object.entries(obj);
    if (entries.length === 0) {
      return <div className="empty">Keine Felder</div>;
    }
    return (
      <div className="fields">
        {entries.map(([key, value]) => {
          if (key === "selectedRankKey") return null; // das Feld nicht als normales Query-Feld anzeigen
          return (
            <div className="field-row" key={key}>
              <div className="field-key">{key}</div>
              <div className="field-value">
                {value !== null && value !== undefined
                  ? String(value)
                  : ""}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="app-root">
      <header className="app-header">
        <div>
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

      <main className="app-main">
        {/* Linke Seite: Query */}
        <section className="left-panel">
          <h2>Query</h2>
          <div className="row-info">
            Zeile {data.length ? currentIndex + 1 : 0} / {data.length}
          </div>
          <div className="nav-buttons">
            <button onClick={goPrev} disabled={currentIndex <= 0}>
              ◀ Zurück
            </button>
            <button
              onClick={goNext}
              disabled={currentIndex >= data.length - 1}
            >
              Weiter ▶
            </button>
          </div>
          <div className="panel-content">
            {currentRow ? (
              renderObjectFields(currentRow.Query)
            ) : (
              <div className="empty">Keine Daten geladen.</div>
            )}
          </div>
        </section>

        {/* Rechte Seite: Rank-Karten */}
        <section className="right-panel">
          <h2>Antwort-Ranks</h2>
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
                      Diesen Rank als Antwort wählen
                    </label>
                  </div>
                  <div className="card-body">
                    {renderObjectFields(obj)}
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
