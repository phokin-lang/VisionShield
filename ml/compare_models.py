"""
Compare the current PPE model against a newly trained one on the same split.

    python compare_models.py --new runs/detect/ppe_v2/weights/best.pt
    python compare_models.py --old model/ppe_hat_vest_nano.pt --new best.pt --split val

The verdict is based on mAP50-95.
"""
import argparse
from pathlib import Path

HERE = Path(__file__).parent


def evaluate(weights, data, split, imgsz, device):
    from ultralytics import YOLO
    box = YOLO(str(weights)).val(data=data, split=split, imgsz=imgsz, device=device, plots=False, verbose=False).box
    return {"mAP50": box.map50, "mAP50-95": box.map, "precision": box.mp, "recall": box.mr}


def main():
    parser = argparse.ArgumentParser(description="Compare old vs new PPE model")
    parser.add_argument("--old", default=str(HERE / "model" / "ppe_hat_vest_nano.pt"))
    parser.add_argument("--new", required=True)
    parser.add_argument("--data", default="dataset_ppe/data.yaml")
    parser.add_argument("--split", default="test", help="test / val")
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--device", default=None)
    args = parser.parse_args()

    for p in (args.old, args.new, args.data):
        if not Path(p).exists():
            raise SystemExit(f"{p} not found")

    old = evaluate(args.old, args.data, args.split, args.imgsz, args.device)
    new = evaluate(args.new, args.data, args.split, args.imgsz, args.device)

    print(f"\nSplit: {args.split}   data: {args.data}")
    print(f"{'metric':<12}{'old':>10}{'new':>10}{'delta':>10}")
    print("-" * 42)
    for k in old:
        print(f"{k:<12}{old[k]:>10.4f}{new[k]:>10.4f}{new[k] - old[k]:>+10.4f}")

    if new["mAP50-95"] > old["mAP50-95"]:
        print(f"\nBETTER: new model improves mAP50-95 by {new['mAP50-95'] - old['mAP50-95']:+.4f}")
    else:
        print(f"\nNOT better: new mAP50-95 {new['mAP50-95']:.4f} <= old {old['mAP50-95']:.4f}")


if __name__ == "__main__":
    main()
