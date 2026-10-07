import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

dotenv.config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

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
  if (headers.some((header) => !header)) {
    throw new Error("Every CSV column needs a header.");
  }

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

    if (row.status.toLowerCase() === "completed") {
      aggregate.completed_count += 1;
    }

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

async function forwardToDatabricks(fileBuffer, fileName) {
  const targetUrl = process.env.DATABRICKS_PIPELINE_URL;
  const authToken = process.env.DATABRICKS_TOKEN;

  if (!targetUrl) {
    return null;
  }

  const formData = new FormData();
  formData.append(
    "file",
    new Blob([fileBuffer], { type: "application/octet-stream" }),
    fileName,
  );

  const response = await fetch(targetUrl, {
    method: "POST",
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Databricks pipeline returned ${response.status}.`);
  }

  return extractLayers(await response.json());
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    mode: process.env.DATABRICKS_PIPELINE_URL ? "databricks" : "local",
    port: Number(process.env.PORT || 3001),
  });
});

app.post("/api/pipeline", upload.single("file"), async (request, response) => {
  try {
    if (!request.file) {
      return response.status(400).json({ error: "No file was uploaded." });
    }

    const uploadedFile = request.file;
    const fileName = uploadedFile.originalname || "uploaded-file.csv";
    const text = uploadedFile.buffer.toString("utf8");

    let rows = [];
    if (fileName.toLowerCase().endsWith(".json")) {
      const parsedJson = JSON.parse(text);
      rows = Array.isArray(parsedJson)
        ? parsedJson
        : (parsedJson?.data ?? parsedJson?.transactions ?? []);
    } else {
      rows = parseCsv(text);
    }

    if (!Array.isArray(rows)) {
      return response.status(400).json({
        error: "The uploaded JSON must contain an array of transactions.",
      });
    }

    const result =
      (await forwardToDatabricks(uploadedFile.buffer, fileName)) ||
      transformRows(rows, fileName);

    response.json(result);
  } catch (error) {
    return response.status(400).json({
      error:
        error instanceof Error ? error.message : "Pipeline processing failed.",
    });
  }
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Databricks-ready API listening on http://localhost:${port}`);
});
