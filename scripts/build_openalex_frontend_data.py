#!/usr/bin/env python3
"""Build OpenAlex frontend network data from downloaded HF files."""
import csv
import gzip
import itertools
import json
import os
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(".")
OUT = ROOT / "frontend" / "data"
OUT.mkdir(parents=True, exist_ok=True)
WORKS = Path(os.environ.get("SPB_WORKS_CSV", ROOT / "data_openalex" / "works_spb_full.csv.gz"))
AUTH = Path(os.environ.get("SPB_AUTH_CSV", ROOT / "data_openalex" / "authorships_spb_full.csv.gz"))
INST = Path(os.environ.get("SPB_INST_CSV", ROOT / "data_openalex" / "institutions_spb.csv"))

TOP_AUTHORS = int(os.environ.get("TOP_AUTHORS", "12000"))
TOP_EDGES_PER_WINDOW = int(os.environ.get("TOP_EDGES_PER_WINDOW", "3500"))
TOP_EDGES_ALL = int(os.environ.get("TOP_EDGES_ALL", "5000"))
EGO_EDGES_PER_AUTHOR = int(os.environ.get("EGO_EDGES_PER_AUTHOR", "8"))
MAX_AUTHORS_PER_WORK = int(os.environ.get("MAX_AUTHORS_PER_WORK", "50"))


def open_text(path):
    return gzip.open(path, "rt", encoding="utf-8", newline="") if str(path).endswith(".gz") else open(path, encoding="utf-8", newline="")


def read_csv(path):
    with open_text(path) as f:
        yield from csv.DictReader(f)


def make_windows(years):
    years = sorted(y for y in years if y)
    if not years:
        return [("all", None, None, "All years")]
    windows = [("all", None, None, "All years")]
    start_decade = (min(years) // 10) * 10
    end_decade = (max(years) // 10) * 10
    for start in range(start_decade, end_decade + 1, 10):
        end = start + 9
        windows.append((f"{start}-{end}", start, end, f"{start}-{end}"))
    return windows


def window_for_year(year, windows):
    for key, start, end, _ in windows[1:]:
        if (start is None or year >= start) and (end is None or year <= end):
            return key
    return None


def main():
    institutions = []
    with open_text(INST) as f:
        for row in csv.DictReader(f):
            institutions.append(row)

    works_meta = {}
    yearly = defaultdict(lambda: {"works": 0, "international": 0, "over50": 0, "articles": 0})
    types = Counter()
    for row in read_csv(WORKS):
        wid = row["work_id"]
        year = int(row["publication_year"]) if row["publication_year"] else None
        n_auth = int(row["n_authors"] or 0)
        intl = str(row["is_international"]).lower() == "true"
        typ = row["type"]
        works_meta[wid] = {"year": year, "n_authors": n_auth, "is_international": intl, "type": typ, "title": row["title"]}
        if year:
            yearly[year]["works"] += 1
            yearly[year]["international"] += int(intl)
            yearly[year]["over50"] += int(n_auth > MAX_AUTHORS_PER_WORK)
            yearly[year]["articles"] += int(typ == "article")
        types[typ] += 1

    windows = make_windows(yearly.keys())

    author_stats = defaultdict(lambda: {"name": "", "works": 0, "first_year": 9999, "last_year": 0, "institutions": Counter(), "countries": Counter(), "international_works": 0})
    work_authors = defaultdict(dict)
    author_work_sets = defaultdict(set)
    author_intl_work_sets = defaultdict(set)

    for row in read_csv(AUTH):
        aid = row["author_id"]
        if not aid:
            continue
        wid = row["work_id"]
        wm = works_meta.get(wid)
        if not wm:
            continue
        name = row["author_name"] or aid.rsplit("/", 1)[-1]
        work_authors[wid][aid] = name
        st = author_stats[aid]
        st["name"] = name
        year = wm["year"]
        if year:
            st["first_year"] = min(st["first_year"], year)
            st["last_year"] = max(st["last_year"], year)
        if row["institution_name"]:
            st["institutions"][row["institution_name"]] += 1
        if row["country_code"]:
            st["countries"][row["country_code"]] += 1

    for wid, amap in work_authors.items():
        wm = works_meta.get(wid, {})
        for aid in amap:
            author_work_sets[aid].add(wid)
            if wm.get("is_international"):
                author_intl_work_sets[aid].add(wid)
    for aid, works in author_work_sets.items():
        author_stats[aid]["works"] = len(works)
        author_stats[aid]["international_works"] = len(author_intl_work_sets.get(aid, set()))

    ranked_authors = sorted(author_stats.items(), key=lambda kv: (-kv[1]["works"], kv[1]["name"]))
    top_author_ids = set(aid for aid, _ in ranked_authors[:TOP_AUTHORS])

    author_index = []
    for aid, st in ranked_authors[:12000]:
        top_inst = st["institutions"].most_common(1)[0][0] if st["institutions"] else ""
        top_country = st["countries"].most_common(1)[0][0] if st["countries"] else ""
        author_index.append({
            "id": aid,
            "label": st["name"],
            "works": st["works"],
            "international_works": st["international_works"],
            "first_year": None if st["first_year"] == 9999 else st["first_year"],
            "last_year": st["last_year"] or None,
            "institution": top_inst,
            "country": top_country,
        })

    window_edges = {name: Counter() for name, _, _, _ in windows}
    window_node_works = {name: Counter() for name, _, _, _ in windows}
    for wid, amap in work_authors.items():
        wm = works_meta.get(wid)
        if not wm or not wm["year"] or wm["n_authors"] > MAX_AUTHORS_PER_WORK:
            continue
        authors = sorted([a for a in amap if a in top_author_ids])
        if len(authors) < 2:
            continue
        frac = 1.0 / (len(authors) - 1)
        for aid in authors:
            window_node_works["all"][aid] += 1
        for a, b in itertools.combinations(authors, 2):
            window_edges["all"][(a, b)] += frac
        wname = window_for_year(wm["year"], windows)
        if wname:
            for aid in authors:
                window_node_works[wname][aid] += 1
            for a, b in itertools.combinations(authors, 2):
                window_edges[wname][(a, b)] += frac

    def build_network(counter, node_work_counter, max_edges, label):
        ranked_edges = counter.most_common()
        selected = {}
        for pair, weight in ranked_edges[:max_edges]:
            selected[pair] = weight

        incident = defaultdict(list)
        for (a, b), weight in ranked_edges:
            incident[a].append(((a, b), weight))
            incident[b].append(((a, b), weight))

        indexed_ids = {row["id"] for row in author_index}
        for aid in indexed_ids:
            for pair, weight in incident.get(aid, [])[:EGO_EDGES_PER_AUTHOR]:
                selected[pair] = weight

        top_edges = sorted(selected.items(), key=lambda item: (-item[1], item[0][0], item[0][1]))
        node_ids = set()
        for (a, b), _ in top_edges:
            node_ids.add(a); node_ids.add(b)
        nodes = []
        for aid in node_ids:
            st = author_stats[aid]
            top_inst = st["institutions"].most_common(1)[0][0] if st["institutions"] else ""
            nodes.append({"id": aid, "label": st["name"], "works": st["works"], "window_works": node_work_counter.get(aid, 0), "international_works": st["international_works"], "institution": top_inst})
        nodes.sort(key=lambda x: (-x["window_works"], -x["works"], x["label"]))
        edges = [{"source": a, "target": b, "weight": round(w, 4)} for (a, b), w in top_edges]
        return {
            "label": label,
            "nodes": nodes,
            "edges": edges,
            "max_authors_per_work": MAX_AUTHORS_PER_WORK,
            "preview_edges": max_edges,
            "ego_edges_per_author": EGO_EDGES_PER_AUTHOR,
        }

    networks = {}
    for wname, _, _, label in windows:
        max_edges = TOP_EDGES_ALL if wname == "all" else TOP_EDGES_PER_WINDOW
        net = build_network(window_edges[wname], window_node_works[wname], max_edges, label)
        networks[wname] = {"nodes": len(net["nodes"]), "edges": len(net["edges"])}
        (OUT / f"network_{wname}.json").write_text(json.dumps(net, ensure_ascii=False), encoding="utf-8")

    summary = {
        "dataset_id": "openalex",
        "dataset_name": "OpenAlex Saint Petersburg",
        "group_label": "Institution",
        "dataset_note": "OpenAlex data are loaded independently from the configured Hugging Face dataset. All publication years present in the dataset are included.",
        "available_windows": [{"value": key, "label": label} for key, _, _, label in windows],
        "default_window": "all",
        "n_works": len(works_meta),
        "n_authorship_rows": sum(1 for _ in open_text(AUTH)) - 1,
        "n_authors_indexed": len(author_index),
        "n_top_authors_in_network": TOP_AUTHORS,
        "preview_edges_all": TOP_EDGES_ALL,
        "preview_edges_per_window": TOP_EDGES_PER_WINDOW,
        "ego_edges_per_author": EGO_EDGES_PER_AUTHOR,
        "max_authors_per_work_for_graph": MAX_AUTHORS_PER_WORK,
        "yearly": [{"year": y, **yearly[y]} for y in sorted(yearly)],
        "types": [{"type": k, "count": v} for k, v in types.most_common()],
        "windows": networks,
    }
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "authors_index.json").write_text(json.dumps(author_index, ensure_ascii=False), encoding="utf-8")
    (OUT / "institutions.json").write_text(json.dumps(institutions, ensure_ascii=False, indent=2), encoding="utf-8")

    works_index = [{"id": wid, "title": wm["title"], "year": wm["year"], "type": wm["type"], "n_authors": wm["n_authors"], "international": wm["is_international"]} for wid, wm in works_meta.items()]
    works_index.sort(key=lambda x: (-(x["year"] or 0), x["title"] or ""))
    (OUT / "works_index.json").write_text(json.dumps(works_index[:30000], ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"dataset": "openalex", "works": len(works_meta), "authors": len(author_index)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
