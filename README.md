# Strata Data Workspace

A clean medallion dashboard for uploading raw data and reviewing Bronze, Silver, and Gold results in one interface.

## What is added in this project

This project includes:

- a clean React dashboard UI with sidebar navigation and chart sections
- Bronze, Silver, and Gold layer views
- CSV and JSON upload support
- a local pipeline preview mode
- a Databricks-ready API integration layer
- a backend server that accepts uploaded files and returns processed medallion data

The app is designed for the workflow:

Raw data -> Bronze layer -> Silver layer -> Gold layer -> dashboard summary

## How the API works

The frontend sends the uploaded file to the API as a multipart form upload named `file`.

Example request flow:

1. User selects a CSV or JSON file in the UI.
2. The browser calls the configured API endpoint.
3. The backend receives the file and validates it.
4. The backend transforms or forwards the data into Bronze, Silver, and Gold arrays.
5. The UI receives the JSON response and displays the results in the dashboard.

The backend can work in two ways:

- Local mode: it processes the file directly and returns results without needing a real Databricks service.
- Databricks mode: it forwards the file to an external Databricks endpoint if `DATABRICKS_PIPELINE_URL` is configured.

## Local setup steps

### 1. Install dependencies

```sh
npm install
```

### 2. Start the backend API

```sh
npm run server
```

This starts the local API server on:

```text
http://localhost:3001
```

### 3. Start the frontend dashboard

Open a second terminal and run:

```sh
npm run dev
```

The frontend runs at:

```text
http://localhost:5173
```

### 4. Configure environment variables

Create a `.env.local` file with:

```env
PORT=3001
VITE_PIPELINE_API_URL=http://localhost:3001/api/pipeline
DATABRICKS_PIPELINE_URL=
DATABRICKS_TOKEN=
```

- `VITE_PIPELINE_API_URL` is used by the browser to call the upload API.
- `DATABRICKS_PIPELINE_URL` is used by the backend if you want to forward files to a real Databricks workload.
- `DATABRICKS_TOKEN` is optional and should be kept on the server side.

## API contract

The API should return either a direct object or a wrapped object. Both of these are supported:

### Direct response

```json
{
  "bronze": [{ "transaction_id": "T-1", "amount": 20.5 }],
  "silver": [
    { "transaction_id": "T-1", "amount": 20.5, "status": "Completed" }
  ],
  "gold": [
    {
      "transaction_date": "2026-10-01",
      "total_revenue": 20.5,
      "total_transactions": 1
    }
  ]
}
```

### Wrapped response

```json
{
  "data": {
    "layers": {
      "bronze": [{ "transaction_id": "T-1" }],
      "silver": [{ "transaction_id": "T-1" }],
      "gold": [{ "transaction_date": "2026-10-01", "total_revenue": 20.5 }]
    }
  }
}
```

The dashboard expects three arrays named `bronze`, `silver`, and `gold`, and it will show an error if one is missing or the data is not in array format.

## Example upload endpoint behavior

The local API accepts a file upload like this:

```sh
curl -F "file=@sample.csv" http://localhost:3001/api/pipeline
```

The endpoint returns the medallion JSON result, including the Bronze raw rows, Silver cleaned rows, and Gold aggregated totals.

## Connect to a real Databricks backend

If you already have a Databricks or backend service, set `DATABRICKS_PIPELINE_URL` and optionally `DATABRICKS_TOKEN` in `.env.local`.

The backend will then:

- receive the uploaded file
- send it to your Databricks service
- wait for the layer data to return
- pass the result to the dashboard UI

This keeps the frontend simple while the backend handles server-side auth, processing, and Databricks calls.

## Checks

```sh
npm run lint
npm run build
```
