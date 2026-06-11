from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import documents, draft_graphs, insertion, graph, search, qa, extraction, clustering

app = FastAPI(
    title="Personal Knowledge Base",
    version="1.0.0",
    description="A personal knowledge graph system with human-in-the-loop correction",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents.router, prefix="/api", tags=["documents"])
app.include_router(draft_graphs.router, prefix="/api", tags=["draft-graphs"])
app.include_router(extraction.router, prefix="/api", tags=["extraction"])
app.include_router(clustering.router, prefix="/api", tags=["clustering"])
app.include_router(insertion.router, prefix="/api", tags=["insertion"])
app.include_router(graph.router, prefix="/api", tags=["graph"])
app.include_router(search.router, prefix="/api", tags=["search"])
app.include_router(qa.router, prefix="/api", tags=["qa"])


@app.get("/api/health")
async def health():
    return {"status": "ok"}
