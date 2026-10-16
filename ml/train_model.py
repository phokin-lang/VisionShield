"""
Train the v2 PPE model (Hard_hat, Vest) with YOLO11.

Needs a GPU for reasonable training time - use your own machine or the
Colab notebook (train_colab.ipynb). Prepare the dataset first:

    pip install ultralytics
    python prepare_dataset.py
    python train_model.py                      # yolo11n, 120 epochs
    python train_model.py --resume             # continue an interrupted run
"""
import argparse
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Train YOLO11 on the 2-class PPE dataset")
    parser.add_argument("--model", default="yolo11n.pt", help="Base checkpoint to fine-tune")
    parser.add_argument("--data", default="dataset_ppe/data.yaml", help="Path to data.yaml")
    parser.add_argument("--epochs", type=int, default=120)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=-1, help="-1 = auto batch size")
    parser.add_argument("--patience", type=int, default=30)
    parser.add_argument("--device", default=None, help="'0' for first GPU, 'cpu' to force CPU")
    parser.add_argument("--project", default="runs/detect")
    parser.add_argument("--name", default="ppe_v2")
    parser.add_argument("--resume", action="store_true", help="Resume <project>/<name>/weights/last.pt")
    args = parser.parse_args()

    from ultralytics import YOLO

    run_dir = Path(args.project) / args.name

    if args.resume:
        last = run_dir / "weights" / "last.pt"
        if not last.exists():
            raise SystemExit(f"Nothing to resume: {last} not found.")
        model = YOLO(str(last))
        model.train(resume=True)
    else:
        data_path = Path(args.data)
        if not data_path.exists():
            raise SystemExit(
                f"Dataset not found at {data_path}. Run `python prepare_dataset.py` first (see ml/README.md)."
            )
        model = YOLO(args.model)
        model.train(
            data=str(data_path),
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            device=args.device,
            patience=args.patience,
            cos_lr=True,
            hsv_h=0.015,
            hsv_s=0.6,
            hsv_v=0.4,
            degrees=5.0,
            translate=0.1,
            scale=0.5,
            fliplr=0.5,
            flipud=0.0,
            mosaic=1.0,
            close_mosaic=15,
            mixup=0.1,
            copy_paste=0.1,
            cache=True,
            seed=42,
            project=args.project,
            name=args.name,
            exist_ok=True,
        )

    best = run_dir / "weights" / "best.pt"
    if not best.exists():
        best = Path(model.trainer.best)

    # Final evaluation on the held-out test split when the dataset has one
    import yaml
    data_yaml = Path(args.data)
    split = "val"
    if data_yaml.exists():
        cfg = yaml.safe_load(data_yaml.read_text(encoding="utf-8")) or {}
        if cfg.get("test"):
            split = "test"

    metrics = YOLO(str(best)).val(data=str(data_yaml), split=split, imgsz=args.imgsz, device=args.device)
    box = metrics.box
    print(f"\n=== {split} metrics ({best}) ===")
    print(f"mAP50     : {box.map50:.4f}")
    print(f"mAP50-95  : {box.map:.4f}")
    print(f"precision : {box.mp:.4f}")
    print(f"recall    : {box.mr:.4f}")
    print(
        f"\nNext: python compare_models.py --new {best}\n"
        f"      python export_onnx.py --ppe {best} --only ppe"
    )


if __name__ == "__main__":
    main()
