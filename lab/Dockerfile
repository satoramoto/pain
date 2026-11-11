# PAIN lab image: pinned CPU training environment for research jobs.
# Rebuild with `./ai lab build`. The built image ID is recorded in every
# run's provenance row (experiments/lab_runs.jsonl).
FROM python:3.12-slim-bookworm

# torch from the official CPU index first so the cpu wheels resolve cleanly,
# then the remaining pins from PyPI.
RUN pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        torch==2.15.0 && \
    pip install --no-cache-dir \
        numpy==2.1.3 \
        matplotlib==3.9.2 \
        tqdm==4.66.5

WORKDIR /workspace
ENV PYTHONHASHSEED=0
ENV PYTHONUNBUFFERED=1
CMD ["bash"]
