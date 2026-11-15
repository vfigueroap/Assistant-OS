from __future__ import annotations
import multiprocessing
import os
from queue import Empty
from fastapi import FastAPI, File, HTTPException, UploadFile
from extract import MAX_BYTES, extract

app = FastAPI(title="Personal AI OS offline extractor", docs_url=None, redoc_url=None, openapi_url=None)


def _extract_child(data: bytes, filename: str, mime: str, output):
    try:
        output.put({"ok": True, "result": extract(data, filename, mime)})
    except Exception as error:
        # Do not leak raw documents, filesystem paths or library parser internals.
        reason = str(error) if isinstance(error, ValueError) else "document_parse_failed"
        output.put({"ok": False, "reason": reason[:160]})


@app.get("/healthz")
def healthz():
    return {"status": "ok", "mode": "offline"}


@app.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    data = await file.read(MAX_BYTES + 1)
    await file.close()
    if not data or len(data) > MAX_BYTES:
        raise HTTPException(413, "empty_or_oversize_document")
    context = multiprocessing.get_context("spawn")
    output = context.Queue(maxsize=1)
    process = context.Process(target=_extract_child, args=(data, file.filename or "document", file.content_type or "", output))
    process.start()
    # Read queue while the child is alive: joining first can deadlock on a large result.
    try:
        import asyncio
        result = await asyncio.to_thread(output.get, True, int(os.environ.get("EXTRACT_TIMEOUT_SECONDS", "45")))
    except Empty:
        process.terminate()
        raise HTTPException(408, "document_extraction_timeout")
    finally:
        process.join(timeout=2)
        if process.is_alive():
            process.kill()
            process.join(timeout=2)
        output.close()
    if not result["ok"]:
        raise HTTPException(422, result["reason"])
    return result["result"]
