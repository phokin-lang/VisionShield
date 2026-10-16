"""
Turn the 6-class Roboflow PPE export into a 2-class dataset the backend uses.

Source classes (Roboflow): Gloves, Hard_hat, Mask, Person, Safety_boots, Vest
Output classes:            Hard_hat=0, Vest=1   (order expected by backend/services/detector.js)

Label rows for other classes are dropped; rows that are not 5 columns
(e.g. polygon segments) are skipped. Images are copied as-is.

Usage:
    python prepare_dataset.py
    python prepare_dataset.py --src dataset --dst dataset_ppe --keep Hard_hat Vest
"""
import argparse
import shutil
from collections import Counter
from pathlib import Path

import yaml

SPLITS = {"train": "train", "val": "valid", "test": "test"}


def load_names(cfg):
    names = cfg["names"]
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names)]
    return list(names)


def resolve_split_dir(src, cfg, key, default):
    """Return the split root (containing images/ and labels/) or None."""
    entry = cfg.get(key)
    candidates = []
    if entry:
        p = Path(entry)
        # Roboflow writes e.g. ../train/images relative to data.yaml
        candidates += [(src / p).resolve(), (src / p.as_posix().lstrip("./")).resolve()]
        candidates += [src / p.parent.name]
    candidates.append(src / default)
    for c in candidates:
        root = c.parent if c.name == "images" else c
        if (root / "images").is_dir():
            return root
    return None


def main():
    parser = argparse.ArgumentParser(description="Remap Roboflow PPE dataset to Hard_hat/Vest only")
    parser.add_argument("--src", default="dataset", help="Folder with the Roboflow data.yaml")
    parser.add_argument("--dst", default="dataset_ppe", help="Output folder")
    parser.add_argument("--keep", nargs="+", default=["Hard_hat", "Vest"],
                        help="Classes to keep, in output id order")
    args = parser.parse_args()

    src, dst = Path(args.src), Path(args.dst)
    yaml_path = src / "data.yaml"
    if not yaml_path.exists():
        raise SystemExit(f"{yaml_path} not found. Unzip the Roboflow export into {src}/ first.")

    cfg = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
    names = load_names(cfg)
    missing = [k for k in args.keep if k not in names]
    if missing:
        raise SystemExit(f"Classes {missing} not in source names {names}")
    remap = {names.index(k): i for i, k in enumerate(args.keep)}
    print("source classes:", names)
    print("remap:", {names[o]: n for o, n in remap.items()})

    out_cfg = {"path": str(dst.resolve()), "nc": len(args.keep), "names": list(args.keep)}

    for key, default in SPLITS.items():
        split_root = resolve_split_dir(src, cfg, key, default)
        if split_root is None:
            print(f"[{key}] not found, skipped")
            continue

        img_out = dst / default / "images"
        lbl_out = dst / default / "labels"
        img_out.mkdir(parents=True, exist_ok=True)
        lbl_out.mkdir(parents=True, exist_ok=True)

        counts, n_img, skipped = Counter(), 0, 0
        for img in sorted((split_root / "images").iterdir()):
            if not img.is_file():
                continue
            shutil.copy2(img, img_out / img.name)
            n_img += 1

            lbl = split_root / "labels" / (img.stem + ".txt")
            rows = []
            if lbl.exists():
                for line in lbl.read_text(encoding="utf-8").splitlines():
                    parts = line.split()
                    if len(parts) != 5:
                        if parts:
                            skipped += 1
                        continue
                    cls = int(float(parts[0]))
                    if cls not in remap:
                        continue
                    new = remap[cls]
                    rows.append(" ".join([str(new)] + parts[1:]))
                    counts[args.keep[new]] += 1
            (lbl_out / (img.stem + ".txt")).write_text(
                "\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")

        out_cfg[key] = f"{default}/images"
        per_cls = ", ".join(f"{k}={counts[k]}" for k in args.keep)
        print(f"[{key}] images={n_img} boxes: {per_cls}" + (f" (skipped {skipped} non-bbox rows)" if skipped else ""))

    (dst / "data.yaml").write_text(yaml.safe_dump(out_cfg, sort_keys=False), encoding="utf-8")
    print("wrote", dst / "data.yaml")


if __name__ == "__main__":
    main()
