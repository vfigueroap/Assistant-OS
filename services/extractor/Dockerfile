FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ENABLE_OCR=true OCR_LANGUAGES=spa+eng
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-spa tesseract-ocr-eng poppler-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/extractor/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/extractor/app.py services/extractor/extract.py ./
USER 10001:10001
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--limit-concurrency", "2", "--no-access-log"]
