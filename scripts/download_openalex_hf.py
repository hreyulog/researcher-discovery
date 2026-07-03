#!/usr/bin/env python3
"""Download the OpenAlex SPB dataset from Hugging Face."""
import argparse
import shutil
import urllib.request
from pathlib import Path

FILES = [
    "works_spb_full.csv.gz",
    "authorships_spb_full.csv.gz",
    "institutions_spb.csv",
    "summary_full.json",
]


def download(url, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.stat().st_size > 0:
        print(f"exists {path}")
        return
    tmp = path.with_suffix(path.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "researcher-discovery/0.1"})
    print(f"download {url}")
    with urllib.request.urlopen(req, timeout=180) as response, open(tmp, "wb") as f:
        shutil.copyfileobj(response, f, length=1024 * 1024)
    tmp.replace(path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default="hreyulog/spb-researcher-openalex")
    parser.add_argument("--revision", default="main")
    parser.add_argument("--out", default="data_openalex")
    args = parser.parse_args()

    out = Path(args.out)
    base = f"https://huggingface.co/datasets/{args.repo}/resolve/{args.revision}"
    for name in FILES:
        download(f"{base}/{name}", out / name)


if __name__ == "__main__":
    main()
