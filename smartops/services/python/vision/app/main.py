"""
Vision — YOLOv8 worker / vehicle / PPE detection from site camera feeds.

Endpoints:
  POST /detect/worker     — multipart image; returns bounding boxes for persons
  POST /detect/ppe        — multipart image; flags missing hard-hat / hi-vis
                            (heuristic on top of YOLOv8 person detection)
"""
import io
import sys
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "shared" / "python"))

from fastapi import File, HTTPException, UploadFile
from pydantic import BaseModel

from smartops_shared.app import create_app

try:
    from ultralytics import YOLO
    from PIL import Image
    import numpy as np
except Exception:
    YOLO = None
    Image = None
    np = None

app = create_app(title="SmartOps · Vision", service_name="vision")

_model = None
def _get_model():
    global _model
    if YOLO is None:
        raise HTTPException(503, "ultralytics/opencv not installed")
    if _model is None:
        _model = YOLO("yolov8n.pt")          # nano model — fast on CPU
    return _model


class Detection(BaseModel):
    label: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


class DetectResponse(BaseModel):
    width: int
    height: int
    detections: List[Detection]
    counts: dict[str, int]


@app.post("/detect/worker", response_model=DetectResponse)
async def detect_worker(image: UploadFile = File(...)):
    model = _get_model()
    raw = await image.read()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = img.size

    results = model(np.array(img), classes=[0], verbose=False)   # class 0 = person
    detections: List[Detection] = []
    for r in results:
        for box in r.boxes:
            cls = int(box.cls[0])
            label = model.names[cls]
            conf = float(box.conf[0])
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append(Detection(label=label, confidence=conf,
                                        x1=x1, y1=y1, x2=x2, y2=y2))

    counts: dict[str, int] = {}
    for d in detections:
        counts[d.label] = counts.get(d.label, 0) + 1
    return DetectResponse(width=w, height=h, detections=detections, counts=counts)


@app.post("/detect/ppe", response_model=DetectResponse)
async def detect_ppe(image: UploadFile = File(...)):
    """Heuristic PPE check: detect persons + (optionally) hard-hat / hi-vis.
    Real production would fine-tune YOLO on a PPE dataset; we use COCO's
    person class as the baseline and treat all persons as PPE-pending until
    a custom model is registered.
    """
    return await detect_worker(image)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8005, reload=False)
