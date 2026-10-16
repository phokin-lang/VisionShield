"""Convert YOLO .pt weights to the ONNX files the Node backend loads.
Needs a machine with Python + `pip install ultralytics onnx onnxslim` (NOT needed on Render).

  python export_onnx.py                                   # both models
  python export_onnx.py --ppe runs/detect/ppe_v2/weights/best.pt --only ppe
  -> backend/models/ppe_hat_vest_nano.onnx   (classes: Hard_hat=0, Vest=1)
  -> backend/models/person_yolov8n.onnx      (stock COCO yolov8n, Person = class 0)

Existing files are kept as <name>.onnx.bak before being overwritten.
Keep the class order Hard_hat=0, Vest=1 (or edit PPE_CLASSES in backend/services/detector.js).
"""
import argparse
import shutil
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE.parent / "backend" / "models"


def export(src, dst_name):
    from ultralytics import YOLO
    dst = OUT / dst_name
    p = YOLO(str(src)).export(format="onnx", imgsz=640, opset=12, simplify=True, dynamic=False, batch=1)
    if dst.exists():
        shutil.copy2(dst, dst.with_name(dst.name + ".bak"))
        print("backup", dst.with_name(dst.name + ".bak"))
    shutil.copy(p, dst)
    print("wrote", dst)


def main():
    parser = argparse.ArgumentParser(description="Export PPE / person models to backend/models/*.onnx")
    parser.add_argument("--ppe", default=str(HERE / "model" / "ppe_hat_vest_nano.pt"))
    parser.add_argument("--person", default=str(HERE / "model" / "yolov8n.pt"))
    parser.add_argument("--only", choices=["ppe", "person"], help="Export just one model")
    args = parser.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    jobs = [("ppe", args.ppe, "ppe_hat_vest_nano.onnx"), ("person", args.person, "person_yolov8n.onnx")]
    for kind, src, dst in jobs:
        if args.only and args.only != kind:
            continue
        if not Path(src).exists():
            raise SystemExit(f"{src} not found")
        export(src, dst)


if __name__ == "__main__":
    main()
