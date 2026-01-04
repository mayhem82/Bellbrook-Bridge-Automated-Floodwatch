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

River height is pulled from a published Google Sheets CSV feed. The live page polls the feed every 5 minutes and recalculates clearance and status automatically.
