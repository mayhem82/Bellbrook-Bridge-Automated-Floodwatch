#!/usr/bin/env python3
"""Render the Bellbrook flood-camera frame through the locked Cartoon Mode.

Single retained layer only. The source JPEG is transient and is never persisted.
Locked Floodwatch parameters:
- edge thickness: 1x
- edge strength: 70%
"""
import argparse, cv2, json, pathlib
import numpy as np

CARTOON_LEVELS = 6
EDGE_THICKNESS = 1
EDGE_STRENGTH = 70
CARTOON_SATURATION = 135
NIGHT_LUMA_THRESHOLD = 85
NIGHT_EDGE_STRENGTH = 48
NIGHT_LEVELS = 10

def cartoon(img):
    source_gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    median_luma = float(np.median(source_gray))
    night = median_luma < NIGHT_LUMA_THRESHOLD

    if night:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, aa, bb = cv2.split(lab)
        l = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8)).apply(l)
        l = np.clip(l.astype(np.float32) * 1.18 + 10, 0, 255).astype(np.uint8)
        img = cv2.cvtColor(cv2.merge((l, aa, bb)), cv2.COLOR_LAB2BGR)

    smooth = cv2.bilateralFilter(img, 9, 80, 80)
    levels = NIGHT_LEVELS if night else CARTOON_LEVELS
    step = 256.0 / levels
    flat = np.floor(smooth.astype(np.float32) / step) * step + step / 2.0
    flat = np.clip(flat, 0, 255).astype(np.uint8)

    hsv = cv2.cvtColor(flat, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * (CARTOON_SATURATION / 100.0), 0, 255)
    flat = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    gray = cv2.cvtColor(smooth, cv2.COLOR_BGR2GRAY)
    gray = cv2.medianBlur(gray, 5)
    edge_strength = NIGHT_EDGE_STRENGTH if night else EDGE_STRENGTH
    low = max(8, int(90 - edge_strength * 0.65))
    high = max(low + 20, int(190 - edge_strength * 1.15))
    edges = cv2.Canny(gray, low, high)
    flat[edges > 0] = (0, 0, 0)
    return flat, night, median_luma, levels, edge_strength

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--report",default="cartoon-report.json")
    a=ap.parse_args()
    img=cv2.imread(a.src)
    if img is None:
        raise SystemExit("Cannot decode source image")
    out, night, median_luma, levels, edge_strength=cartoon(img)
    if not cv2.imwrite(a.dst,out,[cv2.IMWRITE_JPEG_QUALITY,78]):
        raise SystemExit("Could not write cartoon frame")
    report={
      "mode":"cartoon-only",
      "profile":"night" if night else "day",
      "median_luminance":round(median_luma,1),
      "cartoon_levels":levels,
      "edge_thickness_x":EDGE_THICKNESS,
      "edge_strength_percent":edge_strength,
      "saturation_percent":CARTOON_SATURATION
    }
    pathlib.Path(a.report).write_text(json.dumps(report,indent=2)+"\n")
    print("cartoon frame rendered:", "night" if night else "day", "profile; median luminance", round(median_luma,1), "edge strength", edge_strength)

if __name__=="__main__":
    main()
