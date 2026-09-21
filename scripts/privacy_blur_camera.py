#!/usr/bin/env python3
"""Privacy-process a Bellbrook flood-camera frame.

Detect people and road vehicles with OpenCV's bundled MobileNet-SSD model and
irreversibly Gaussian-blur padded detection regions before any persistence.
Fails closed when the detector/model is unavailable.
"""
import argparse, cv2, json, pathlib, sys

CLASSES = ["background","aeroplane","bicycle","bird","boat","bottle","bus","car","cat",
           "chair","cow","diningtable","dog","horse","motorbike","person","pottedplant",
           "sheep","sofa","train","tvmonitor"]
PRIVATE = {"person","bicycle","bus","car","motorbike"}
PADDING = 0.18

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("src"); ap.add_argument("dst")
    ap.add_argument("--proto",required=True); ap.add_argument("--model",required=True)
    ap.add_argument("--confidence",type=float,default=0.30)
    ap.add_argument("--report",default="privacy-report.json")
    a=ap.parse_args()
    img=cv2.imread(a.src)
    if img is None: raise SystemExit("Cannot decode source image")
    net=cv2.dnn.readNetFromCaffe(a.proto,a.model)
    h,w=img.shape[:2]
    blob=cv2.dnn.blobFromImage(cv2.resize(img,(300,300)),0.007843,(300,300),127.5)
    net.setInput(blob); detections=net.forward()
    hits=[]
    for i in range(detections.shape[2]):
        conf=float(detections[0,0,i,2]); idx=int(detections[0,0,i,1])
        if conf < a.confidence or idx >= len(CLASSES) or CLASSES[idx] not in PRIVATE: continue
        x1,y1,x2,y2=(detections[0,0,i,3:7]*[w,h,w,h]).astype(int)
        pad_x=int(max(1,x2-x1)*PADDING); pad_y=int(max(1,y2-y1)*PADDING)
        x1=max(0,x1-pad_x); y1=max(0,y1-pad_y); x2=min(w,x2+pad_x); y2=min(h,y2+pad_y)
        if x2<=x1 or y2<=y1: continue
        roi=img[y1:y2,x1:x2]
        # Large irreversible blur; odd kernel bounded by region dimensions.
        k=max(15,min(99,(min(roi.shape[:2])//3)|1))
        img[y1:y2,x1:x2]=cv2.GaussianBlur(roi,(k,k),0)
        hits.append({"class":CLASSES[idx],"confidence":round(conf,3),"box":[x1,y1,x2,y2]})
    if not cv2.imwrite(a.dst,img,[cv2.IMWRITE_JPEG_QUALITY,75]):
        raise SystemExit("Could not write privacy-processed frame")
    pathlib.Path(a.report).write_text(json.dumps({"detections":hits,"count":len(hits)},indent=2)+"\n")
    print(f"privacy blur applied to {len(hits)} detected people/vehicle regions")
if __name__=="__main__": main()
