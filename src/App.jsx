import { useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Check,
  CircleHelp,
  Clock3,
  Database,
  FileSpreadsheet,
  History,
  Layers3,
  LoaderCircle,
  Play,
  TrendingUp,
  UploadCloud,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const API_URL = import.meta.env.VITE_PIPELINE_API_URL;
const layerTabs = [
  {
    id: "bronze",
    label: "Bronze",
    description: "Raw ingestion",
    icon: Database,
  },
  {
    id: "silver",
    label: "Silver",
    description: "Cleaned records",
    icon: Layers3,
  },
  {
    id: "gold",
    label: "Gold",
    description: "Business metrics",
    icon: TrendingUp,
  },
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted)
    throw new Error("The CSV file contains an unclosed quoted field.");
  if (rows.length < 2) throw new Error("The selected file has no data rows.");

  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  if (headers.some((header) => !header))
    throw new Error("Every CSV column needs a header.");
  return rows
    .slice(1)
    .map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, values[index]?.trim() ?? ""]),
      ),
    );
}

function normalizeRows(value, layerName) {
  if (!Array.isArray(value)) {
    throw new Error(`The API response is missing a ${layerName} array.`);
  }
  if (
    value.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  ) {
    throw new Error(`The ${layerName} response must contain objects.`);
  }
  return value;
}

function transformRows(rows, sourceName) {
  const timestamp = new Date().toISOString();
  const bronze = rows.map((row) => ({
    ...row,
    ingestion_timestamp: row.ingestion_timestamp || timestamp,
    raw_source: row.raw_source || sourceName,
  }));
  const silver = bronze.flatMap((row) => {
    const amountValue = Number(row.amount);
    const status = String(row.status ?? "").trim();
    if (
      !row.transaction_id ||
      !row.transaction_date ||
      !status ||
      !Number.isFinite(amountValue) ||
      status.toLowerCase() === "failed"
    ) {
      return [];
    }
    return [
      {
        ...row,
        user_id:
          row.user_id === undefined || row.user_id === ""
            ? null
            : Number(row.user_id),
        amount: amountValue,
        status,
        is_clean: true,
      },
    ];
  });

  const grouped = new Map();
  silver.forEach((row) => {
    const aggregate = grouped.get(row.transaction_date) || {
      transaction_date: row.transaction_date,
      total_revenue: 0,
      total_transactions: 0,
      completed_count: 0,
    };
    aggregate.total_revenue += row.amount;
    aggregate.total_transactions += 1;
    if (row.status.toLowerCase() === "completed")
      aggregate.completed_count += 1;
    grouped.set(row.transaction_date, aggregate);
  });

  const gold = [...grouped.values()]
    .sort((left, right) =>
      String(left.transaction_date).localeCompare(
        String(right.transaction_date),
      ),
    )
    .map((row) => ({
      ...row,
      total_revenue: Number(row.total_revenue.toFixed(2)),
    }));
  return { bronze, silver, gold };
}

function extractLayers(payload) {
  const layers =
    payload?.data?.layers || payload?.layers || payload?.data || payload;
  return {
    bronze: normalizeRows(layers.bronze ?? layers.bronze_data, "Bronze"),
    silver: normalizeRows(layers.silver ?? layers.silver_data, "Silver"),
    gold: normalizeRows(layers.gold ?? layers.gold_data, "Gold"),
  };
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function DataTable({ rows, layer }) {
  const columns = useMemo(() => {
    if (!rows.length) return [];
    const preferred =
      layer === "bronze"
        ? [
            "transaction_id",
            "user_id",
            "transaction_date",
            "amount",
            "status",
            "ingestion_timestamp",
            "raw_source",
          ]
        : layer === "silver"
          ? [
              "transaction_id",
              "user_id",
              "transaction_date",
              "amount",
              "status",
              "is_clean",
            ]
          : [
              "transaction_date",
              "total_revenue",
              "total_transactions",
              "completed_count",
            ];
    const available = new Set(rows.flatMap((row) => Object.keys(row)));
    return [
      ...preferred.filter((column) => available.has(column)),
      ...[...available].filter((column) => !preferred.includes(column)),
    ].slice(0, 8);
  }, [layer, rows]);

  if (!rows.length) {
    return (
      <div className="empty-state">
        <Database size={23} />
        <strong>No {layer} records yet</strong>
        <span>Upload a CSV or JSON file to populate this layer.</span>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column.replaceAll("_", " ")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((row, index) => (
            <tr
              key={`${row.transaction_id || row.transaction_date || "row"}-${index}`}
            >
              {columns.map((column) => (
                <td key={column}>{formatValue(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 100 && (
        <p className="table-note">
          Showing 100 of {rows.length.toLocaleString()} records.
        </p>
      )}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState("gold");
  const [file, setFile] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState("");
  const [pipelineMode, setPipelineMode] = useState("");
  const [layers, setLayers] = useState({ bronze: [], silver: [], gold: [] });
  const [history, setHistory] = useState([]);

  const runPipeline = async () => {
    if (!file || isProcessing) return;
    setError("");
    setIsProcessing(true);
    try {
      let result;
      if (API_URL) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(API_URL, {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          const message = await response.text();
          throw new Error(
            message || `Pipeline API returned ${response.status}.`,
          );
        }
        result = extractLayers(await response.json());
        setPipelineMode("api");
      } else {
        const text = await file.text();
        const rawRows = file.name.toLowerCase().endsWith(".json")
          ? JSON.parse(text)
          : parseCsv(text);
        const rows = Array.isArray(rawRows)
          ? rawRows
          : (rawRows?.data ?? rawRows?.transactions);
        if (!Array.isArray(rows))
          throw new Error(
            "JSON files must contain an array of transaction objects.",
          );
        result = transformRows(rows, file.name);
        setPipelineMode("local");
      }
      setLayers(result);
      setHistory((current) => [
        {
          id: Date.now(),
          file: file.name,
          timestamp: new Date().toLocaleString(),
          mode: API_URL ? "API pipeline" : "Local transform",
          counts: `${result.bronze.length} / ${result.silver.length} / ${result.gold.length}`,
        },
        ...current,
      ]);
      setActiveTab("gold");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The pipeline could not process this file.",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const totals = useMemo(
    () => ({
      revenue: layers.gold.reduce(
        (sum, row) => sum + (Number(row.total_revenue) || 0),
        0,
      ),
      transactions: layers.gold.reduce(
        (sum, row) => sum + (Number(row.total_transactions) || 0),
        0,
      ),
    }),
    [layers.gold],
  );

  const tabTitle =
    activeTab === "ingest"
      ? "Data ingestion"
      : activeTab === "history"
        ? "Run history"
        : `${activeTab} layer`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" onClick={() => setActiveTab("gold")}>
          <span className="brand-mark">
            <Layers3 size={19} />
          </span>
          <span>
            <strong>Strata</strong>
            <small>DATA WORKSPACE</small>
          </span>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <button
          className={`nav-item ${activeTab === "ingest" ? "selected" : ""}`}
          aria-label="Ingestion"
          title="Ingestion"
          onClick={() => setActiveTab("ingest")}
        >
          <UploadCloud size={17} />
          <span>Ingestion</span>
          <ArrowRight className="nav-arrow" size={15} />
        </button>
        <div className="nav-label layer-label">MEDALLION LAYERS</div>
        {layerTabs.map(({ id, label, description, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item layer-nav ${activeTab === id ? "selected" : ""}`}
            aria-label={`${label}: ${description}`}
            title={`${label}: ${description}`}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={17} />
            <span className="nav-copy">
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            <span className={`layer-dot ${id}`} />
          </button>
        ))}
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${activeTab === "history" ? "selected" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            <History size={17} />
            <span>Run history</span>
          </button>
          <div
            className={`connection-status ${API_URL ? "connected" : "local"}`}
          >
            <span className="status-dot" />
            <span>
              <strong>
                {API_URL ? "Pipeline API configured" : "Local processing"}
              </strong>
              <small>
                {API_URL ? "Endpoint ready" : "No endpoint configured"}
              </small>
            </span>
            <CircleHelp
              size={15}
              title={
                API_URL
                  ? API_URL
                  : "Set VITE_PIPELINE_API_URL to enable API runs"
              }
            />
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>{tabTitle}</strong>
          </div>
          <div className="topbar-meta">
            <span className="live-indicator">
              <span />
              {pipelineMode === "api" ? "API connected" : "Workspace ready"}
            </span>
            <span className="avatar">DS</span>
          </div>
        </header>
        <div className="page-content">
          <section className="page-heading">
            <div>
              <p className="eyebrow">
                DATA PLATFORM <span>·</span> MEDALLION ARCHITECTURE
              </p>
              <h1>
                {activeTab === "gold"
                  ? "Your data, refined."
                  : activeTab === "ingest"
                    ? "Bring data in."
                    : activeTab === "history"
                      ? "Pipeline activity."
                      : `${activeTab[0].toUpperCase()}${activeTab.slice(1)} data.`}
              </h1>
              <p className="heading-description">
                {activeTab === "gold"
                  ? "A clear view from raw records to business-ready metrics."
                  : activeTab === "ingest"
                    ? "Upload transaction data and move it through the medallion layers."
                    : "Explore the records produced by your data pipeline."}
              </p>
            </div>
            <button
              className="primary-button heading-action"
              onClick={() => setActiveTab("ingest")}
            >
              <UploadCloud size={16} /> New ingestion
            </button>
          </section>

          {error && (
            <div className="error-banner" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}

          {activeTab === "ingest" && (
            <section className="ingest-layout">
              <div className="panel ingest-panel">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">SOURCE FILE</span>
                    <h2>Start with your data</h2>
                  </div>
                  <span className="step-count">
                    01 <span>/ 03</span>
                  </span>
                </div>
                <label
                  className={`upload-zone ${file ? "has-file" : ""}`}
                  htmlFor="data-file"
                >
                  <input
                    id="data-file"
                    type="file"
                    accept=".csv,.json,text/csv,application/json"
                    onChange={(event) => {
                      setFile(event.target.files?.[0] || null);
                      setError("");
                    }}
                  />
                  {file ? (
                    <>
                      <FileSpreadsheet size={27} />
                      <strong>{file.name}</strong>
                      <span>
                        {(file.size / 1024).toLocaleString(undefined, {
                          maximumFractionDigits: 1,
                        })}{" "}
                        KB · Ready to process
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="upload-icon">
                        <UploadCloud size={23} />
                      </span>
                      <strong>Choose a CSV or JSON file</strong>
                      <span>Click to browse files on your computer</span>
                      <span className="file-types">
                        CSV <i /> JSON
                      </span>
                    </>
                  )}
                </label>
                {file && (
                  <button
                    className="text-button remove-file"
                    onClick={() => setFile(null)}
                  >
                    <X size={14} /> Remove file
                  </button>
                )}
                <div className="pipeline-flow">
                  <div>
                    <span className="flow-node bronze">
                      <Database size={16} />
                    </span>
                    <strong>Bronze</strong>
                    <small>Raw</small>
                  </div>
                  <span className="flow-line" />
                  <div>
                    <span className="flow-node silver">
                      <Layers3 size={16} />
                    </span>
                    <strong>Silver</strong>
                    <small>Clean</small>
                  </div>
                  <span className="flow-line" />
                  <div>
                    <span className="flow-node gold">
                      <TrendingUp size={16} />
                    </span>
                    <strong>Gold</strong>
                    <small>Aggregate</small>
                  </div>
                </div>
                <button
                  className="primary-button run-button"
                  onClick={runPipeline}
                  disabled={!file || isProcessing}
                >
                  {isProcessing ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Play size={16} fill="currentColor" />
                  )}
                  {isProcessing
                    ? "Processing file..."
                    : API_URL
                      ? "Run API pipeline"
                      : "Process file locally"}
                  <ArrowRight size={16} />
                </button>
              </div>
              <aside className="panel source-panel">
                <span className="section-kicker">PIPELINE CONFIGURATION</span>
                <h2>{API_URL ? "API pipeline" : "Local preview"}</h2>
                <p>
                  {API_URL
                    ? "The file will be sent to your configured endpoint. It must return Bronze, Silver, and Gold arrays."
                    : "No API endpoint is configured. The file will be transformed in your browser so you can preview all three layers."}
                </p>
                <div className="config-detail">
                  <span>Accepted formats</span>
                  <strong>CSV, JSON</strong>
                </div>
                <div className="config-detail">
                  <span>Bronze → Silver</span>
                  <strong>Validate & clean</strong>
                </div>
                <div className="config-detail">
                  <span>Silver → Gold</span>
                  <strong>Group by date</strong>
                </div>
                {!API_URL && (
                  <div className="setup-hint">
                    <Activity size={15} />
                    <span>
                      Set <code>VITE_PIPELINE_API_URL</code> in{" "}
                      <code>.env.local</code> to connect the API.
                    </span>
                  </div>
                )}
              </aside>
            </section>
          )}

          {activeTab === "gold" && (
            <>
              <section className="metric-grid">
                <article className="metric-card">
                  <div className="metric-top">
                    <span>GOLD REVENUE</span>
                    <span className="metric-icon green">
                      <TrendingUp size={17} />
                    </span>
                  </div>
                  <strong>
                    $
                    {totals.revenue.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </strong>
                  <small>Aggregated transaction value</small>
                </article>
                <article className="metric-card">
                  <div className="metric-top">
                    <span>TRANSACTIONS</span>
                    <span className="metric-icon blue">
                      <Activity size={17} />
                    </span>
                  </div>
                  <strong>{totals.transactions.toLocaleString()}</strong>
                  <small>
                    Across {layers.gold.length} date
                    {layers.gold.length === 1 ? "" : "s"}
                  </small>
                </article>
                <article className="metric-card">
                  <div className="metric-top">
                    <span>SILVER RECORDS</span>
                    <span className="metric-icon amber">
                      <Check size={17} />
                    </span>
                  </div>
                  <strong>{layers.silver.length.toLocaleString()}</strong>
                  <small>Validated and ready to analyze</small>
                </article>
                <article className="metric-card pipeline-metric">
                  <div className="metric-top">
                    <span>LAST RUN</span>
                    <span className="metric-icon neutral">
                      <Clock3 size={17} />
                    </span>
                  </div>
                  <strong>{history[0] ? "Complete" : "Not run"}</strong>
                  <small>
                    {history[0]
                      ? history[0].timestamp
                      : "Upload a file to get started"}
                  </small>
                </article>
              </section>
              <section className="chart-grid">
                <article className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">GOLD LAYER</span>
                      <h2>Revenue over time</h2>
                    </div>
                    <span className="chart-unit">USD</span>
                  </div>
                  {layers.gold.length ? (
                    <div className="chart-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={layers.gold}
                          margin={{ top: 12, right: 12, left: 2, bottom: 2 }}
                        >
                          <CartesianGrid stroke="#e9ece7" vertical={false} />
                          <XAxis
                            dataKey="transaction_date"
                            tick={{ fill: "#848981", fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: "#848981", fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(value) => `$${value}`}
                          />
                          <Tooltip
                            formatter={(value) => [
                              `$${Number(value).toFixed(2)}`,
                              "Revenue",
                            ]}
                            contentStyle={{
                              border: "1px solid #e5e8e2",
                              borderRadius: 5,
                              fontSize: 12,
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="total_revenue"
                            stroke="#c26d3c"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: "#c26d3c", strokeWidth: 0 }}
                            activeDot={{ r: 5 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="chart-empty">
                      Upload transaction data to see revenue trends.
                    </div>
                  )}
                </article>
                <article className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker">GOLD LAYER</span>
                      <h2>Daily volume</h2>
                    </div>
                    <span className="chart-unit">RECORDS</span>
                  </div>
                  {layers.gold.length ? (
                    <div className="chart-wrap">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={layers.gold}
                          margin={{ top: 12, right: 12, left: 2, bottom: 2 }}
                        >
                          <CartesianGrid stroke="#e9ece7" vertical={false} />
                          <XAxis
                            dataKey="transaction_date"
                            tick={{ fill: "#848981", fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: "#848981", fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            allowDecimals={false}
                          />
                          <Tooltip
                            contentStyle={{
                              border: "1px solid #e5e8e2",
                              borderRadius: 5,
                              fontSize: 12,
                            }}
                          />
                          <Bar
                            dataKey="total_transactions"
                            name="Transactions"
                            fill="#668976"
                            radius={[3, 3, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="chart-empty">
                      Daily transaction totals will appear here.
                    </div>
                  )}
                </article>
              </section>
              <section className="panel layer-summary">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">DATA JOURNEY</span>
                    <h2>Medallion layers</h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setActiveTab("bronze")}
                  >
                    Explore data <ArrowRight size={14} />
                  </button>
                </div>
                <div className="summary-layers">
                  {layerTabs.map(
                    ({ id, label, description, icon: Icon }, index) => (
                      <button
                        className="summary-layer"
                        key={id}
                        onClick={() => setActiveTab(id)}
                      >
                        <span className={`summary-icon ${id}`}>
                          <Icon size={17} />
                        </span>
                        <span className="summary-copy">
                          <strong>{label}</strong>
                          <small>{description}</small>
                        </span>
                        <strong className="summary-count">
                          {layers[id].length.toLocaleString()}{" "}
                          <small>rows</small>
                        </strong>
                        {index < 2 && (
                          <ArrowRight className="summary-arrow" size={15} />
                        )}
                      </button>
                    ),
                  )}
                </div>
              </section>
            </>
          )}

          {(activeTab === "bronze" || activeTab === "silver") && (
            <section className="panel data-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">
                    {activeTab.toUpperCase()} LAYER ·{" "}
                    {layers[activeTab].length.toLocaleString()} ROWS
                  </span>
                  <h2>
                    {activeTab === "bronze"
                      ? "Raw transactions"
                      : "Validated transactions"}
                  </h2>
                </div>
                <span className={`layer-chip ${activeTab}`}>
                  {activeTab === "bronze" ? "RAW" : "CLEAN"}
                </span>
              </div>
              <DataTable rows={layers[activeTab]} layer={activeTab} />
            </section>
          )}

          {activeTab === "gold" && layers.gold.length > 0 && (
            <section className="panel data-panel gold-table">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">
                    GOLD LAYER · {layers.gold.length.toLocaleString()} ROWS
                  </span>
                  <h2>Daily summary</h2>
                </div>
                <span className="layer-chip gold">AGGREGATED</span>
              </div>
              <DataTable rows={layers.gold} layer="gold" />
            </section>
          )}

          {activeTab === "history" && (
            <section className="panel data-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">PIPELINE</span>
                  <h2>Recent runs</h2>
                </div>
              </div>
              {history.length ? (
                <div className="history-list">
                  {history.map((run) => (
                    <div className="history-row" key={run.id}>
                      <span className="history-check">
                        <Check size={15} />
                      </span>
                      <span className="history-file">
                        <strong>{run.file}</strong>
                        <small>
                          {run.mode} · Bronze / Silver / Gold rows: {run.counts}
                        </small>
                      </span>
                      <span className="history-time">{run.timestamp}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <History size={23} />
                  <strong>No pipeline runs yet</strong>
                  <span>Your completed runs will appear here.</span>
                </div>
              )}
            </section>
          )}

          <footer className="page-footer">
            <span>STRATA DATA WORKSPACE</span>
            <span>
              BRONZE <i /> SILVER <i /> GOLD
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
