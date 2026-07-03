# Saint Petersburg Researcher Network Explorer

Static OpenAlex researcher collaboration network explorer.

At Docker build time the project downloads the OpenAlex Saint Petersburg dataset from Hugging Face, builds browser-ready network JSON files, and serves the frontend with nginx.

Data source:

- https://huggingface.co/datasets/hreyulog/spb-researcher-openalex

## Docker

Build:

```bash
docker build -t researcher-discovery .
```

Run:

```bash
docker run --rm -p 8080:80 researcher-discovery
```

Open:

```text
http://localhost:8080
```

Useful build args:

```bash
docker build \
  --build-arg HF_REPO=hreyulog/spb-researcher-openalex \
  --build-arg HF_REVISION=main \
  -t researcher-discovery .
```

## Local Build

Build frontend data from Hugging Face:

```bash
python scripts/download_openalex_hf.py
python scripts/build_openalex_frontend_data.py
```

Run the static frontend:

```bash
python -m http.server 5173 --directory frontend
```

## Notes

- All publication years present in the downloaded OpenAlex dataset are included.
- Network windows are generated dynamically from the available years.
- Nodes are authors; edges are coauthorship links.
- Node colors represent each author's main institution.
