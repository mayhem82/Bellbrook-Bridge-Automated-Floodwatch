# Bellbrook-Bridge-Automated-Floodwatch
# Bellbrook Bridge Automated Floodwatch

Static site that shows the latest river height at Bellbrook Bridge, calculates deck clearance (2.80 m), and provides quick access to official resources.

## Running locally

No build step is required. Serve the HTML files from the repo root:

```bash
python -m http.server 8000
```

Then open http://localhost:8000 in your browser.

## Data source

River height uses the OpenDataSoft mirror of Bureau of Meteorology observations for Bellbrook station 059122. The current and historical datasets are fetched together. The historical dataset supplies captured observations from before the app was opened; the chart retains up to 12 hours ending at the latest valid observation and displays the actual available span.

Requests stop after 15 seconds, including response-body reads. Failed loads show a Retry button. Saved readings retain their original timestamps and are explicitly labelled when the source is unavailable. Observation times use AEST (UTC+10).

The Update Floodwatch button checks the service worker and reloads the latest page without removing the installed app. Cache cleanup is limited to Floodwatch caches.

## Regression checks

Run the built-in Node.js test suite before publishing changes:

```bash
node --test tests/floodwatch.test.cjs
```

These checks cover script parsing, captured history, request/body timeouts, retry, invalid data, saved observations, blocked storage/canvas, app updates, and service-worker cache isolation.
