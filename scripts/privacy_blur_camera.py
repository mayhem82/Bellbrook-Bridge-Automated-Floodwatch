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

def cartoon(img):
    # Smooth small photographic detail before colour quantisation.
    smooth = cv2.bilateralFilter(img, 9, 80, 80)

    # Match Color Vision's flat-colour concept: six bands per channel.
    step = 256.0 / CARTOON_LEVELS
    flat = (np.floor(smooth.astype(np.float32) / step) * step + step / 2.0)
    flat = np.clip(flat, 0, 255).astype(np.uint8)

    # Locked saturation = 135%.
    hsv = cv2.cvtColor(flat, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:,:,1] = np.clip(hsv[:,:,1] * (CARTOON_SATURATION / 100.0), 0, 255)
    flat = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    # Locked edge thickness 1x and strength 70%.
    gray = cv2.cvtColor(smooth, cv2.COLOR_BGR2GRAY)
    gray = cv2.medianBlur(gray, 5)
    # Higher strength lowers the Canny thresholds so softer structural edges ink.
    low = max(8, int(90 - EDGE_STRENGTH * 0.65))
    high = max(low + 20, int(190 - EDGE_STRENGTH * 1.15))
    edges = cv2.Canny(gray, low, high)
    if EDGE_THICKNESS > 1:
        k = np.ones((EDGE_THICKNESS, EDGE_THICKNESS), np.uint8)
        edges = cv2.dilate(edges, k, iterations=1)
    flat[edges > 0] = (0, 0, 0)
    return flat

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--report",default="cartoon-report.json")
    a=ap.parse_args()
    img=cv2.imread(a.src)
    if img is None:
        raise SystemExit("Cannot decode source image")
    out=cartoon(img)
    if not cv2.imwrite(a.dst,out,[cv2.IMWRITE_JPEG_QUALITY,78]):
        raise SystemExit("Could not write cartoon frame")
    report={
      "mode":"cartoon-only",
      "cartoon_levels":CARTOON_LEVELS,
      "edge_thickness_x":EDGE_THICKNESS,
      "edge_strength_percent":EDGE_STRENGTH,
      "saturation_percent":CARTOON_SATURATION
    }
    pathlib.Path(a.report).write_text(json.dumps(report,indent=2)+"\n")
    print("cartoon frame rendered: edge thickness 1x; edge strength 70%")

if __name__=="__main__":
    main()
