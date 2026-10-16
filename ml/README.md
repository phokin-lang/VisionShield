# ML assets
`.pt` weights from the friend's PPE project (Hard_hat, Vest; mAP50 ≈ 0.96) plus stock yolov8n for people.
The backend runs the **ONNX** versions in `backend/models/` (no Python at runtime).
Re-generate them with `python export_onnx.py`.

## Face blur model
`backend/models/face_scrfd_500m.onnx` is the SCRFD-500M face detector from the InsightFace "buffalo_sc"
pack (2.5 MB). InsightFace's pretrained models are published for non-commercial research use, which is fine
for a course project; check the licence (or swap in another detector) before any commercial deployment.

## Train a better PPE model (v2)
YOLO11n fine-tuned on the Roboflow PPE dataset, reduced to the two classes the backend uses (Hard_hat=0, Vest=1).
Easiest on a free GPU: open `train_colab.ipynb` in Google Colab and run the cells in order.
Locally (GPU recommended):

```bash
pip install ultralytics onnx onnxslim

# 1. Unzip the Roboflow 6-class export (YOLOv8 format) into ml/dataset/, then keep Hard_hat + Vest only
python prepare_dataset.py --src dataset --dst dataset_ppe --keep Hard_hat Vest

# 2. Train (yolo11n, 120 epochs, auto batch) -> runs/detect/ppe_v2/weights/best.pt
python train_model.py
python train_model.py --resume          # continue an interrupted run

# 3. Compare against the current model on the test split (verdict by mAP50-95)
python compare_models.py --new runs/detect/ppe_v2/weights/best.pt

# 4. If BETTER, export over backend/models/ppe_hat_vest_nano.onnx (old file kept as .onnx.bak)
python export_onnx.py --ppe runs/detect/ppe_v2/weights/best.pt --only ppe
```

`ml/dataset/`, `ml/dataset_ppe/` and `runs/` are git-ignored.
