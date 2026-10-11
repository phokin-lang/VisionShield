"""
Fine-tune a YOLOv8 model on the VisionShield PPE-Detection dataset.

Requires a GPU for a reasonable training time (CPU-only will work but is very
slow). Run this on your own machine or a free Google Colab GPU runtime, then
copy the resulting weights into ml/model/best.pt.

Usage:
    pip install ultralytics
    python train_model.py --data dataset/data.yaml --epochs 80 --imgsz 640
"""
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Train YOLOv8 on the PPE dataset")
    parser.add_argument("--data", default="dataset/data.yaml", help="Path to data.yaml")
    parser.add_argument("--model", default="yolov8n.pt", help="Base checkpoint to fine-tune")
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--device", default=None, help="'0' for first GPU, 'cpu' to force CPU")
    args = parser.parse_args()

    from ultralytics import YOLO

    data_path = Path(args.data)
    if not data_path.exists():
        raise SystemExit(
            f"Dataset not found at {data_path}. Unzip the Roboflow export into "
            f"ml/dataset/ first (see ml/README.md)."
        )

    model = YOLO(args.model)
    model.train(
        data=str(data_path),
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        patience=15,
        project="runs/detect",
        name="train",
    )

    metrics = model.val()
    print("\nValidation metrics:", metrics.results_dict)
    print(
        "\nDone. Best weights: runs/detect/train/weights/best.pt\n"
        "Copy that file to ml/model/best.pt to activate live detection in the app."
    )


if __name__ == "__main__":
    main()
