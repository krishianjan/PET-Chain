import os, json, time
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
from memory_store import memory
from memory_layer import persistent_memory
from agents import classify_intent_llm, fast_intent_fallback, generate_rewrites, evaluate_response, offline_evaluate

load_dotenv()
app = FastAPI(title="PET API v1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class RewriteReq(BaseModel):
    prompt:     str
    api_key:    Optional[str] = None
    session_id: str           = "default"

class EvalReq(BaseModel):
    question:   str
    response:   str
    api_key:    Optional[str] = None
    session_id: str           = "default"

class SignalReq(BaseModel):
    user_id:        str
    technique:      str
    domain:         str           = "general"
    provider:       str           = "unknown"
    signal:         str           = "positive"   # positive | negative | copy
    weight:         float         = 1.0
    prompt_snippet: Optional[str] = ""

class MemoryReq(BaseModel):
    user_id: str
    content: str
    metadata: Optional[dict] = None

@app.post("/rewrite")
async def rewrite(req: RewriteReq):
    if not req.prompt: raise HTTPException(400, "Prompt required")
    key = req.api_key or os.getenv("GROQ_API_KEY")
    if not key: raise HTTPException(401, "API key required")

    state  = memory.get(req.session_id)
    intent = await classify_intent_llm(req.prompt, key) or fast_intent_fallback(req.prompt)
    
    # Inject persistent preferences
    domain = intent.get("domain", "general")
    prefs = persistent_memory.build_context_block(req.session_id, domain)
    augmented_prompt = f"{prefs}\n{req.prompt}" if prefs else req.prompt

    data   = await generate_rewrites(augmented_prompt, intent, key)

    memory.update(req.session_id,
        goal=state.goal or data.get("goal", req.prompt[:80]),
        intent=intent.get("task", "explore"),
        persona=intent.get("techniques", [{}])[0].get("persona", "Expert"),
        prompt_count=state.prompt_count + 1,
    )
    return {**data, "intent": intent, "session_id": req.session_id}

@app.post("/evaluate")
async def evaluate(req: EvalReq):
    key   = req.api_key or os.getenv("GROQ_API_KEY")
    state = memory.get(req.session_id)

    # Set goal from question if not already set
    if not state.goal:
        memory.update(req.session_id, goal=req.question[:120])
        state = memory.get(req.session_id)

    if key:
        eval_res = await evaluate_response(req.question, req.response, state, key)
    else:
        eval_res = offline_evaluate(req.question, req.response, state)

    # Persist cumulative goal-completion state from this turn
    cum = eval_res.pop("_cumulative", {})
    new_score = eval_res.get("score", 0)
    new_scores = state.score_history + [new_score]

    # Log interaction for RLHF self-improvement
    persistent_memory.log_interaction(req.session_id, req.question, req.response, new_score)

    memory.update(req.session_id,
        score_history=new_scores[-50:],
        best_score=max(state.best_score, eval_res.get("score", 0)),
        last_response=req.response[:400],
        turn_count=state.turn_count + 1,
        required_elements=cum.get("required_elements", state.required_elements),
        covered_elements= cum.get("covered_elements",  state.covered_elements),
        missing_elements= cum.get("missing_elements",  state.missing_elements),
        completion_pct=   cum.get("completion_pct",    state.completion_pct),
        should_stop=      cum.get("should_stop",       state.should_stop),
        stop_reason=      cum.get("stop_reason",       state.stop_reason),
    )

    grade_map = {"A": "Excellent ✦", "B": "Good ✓", "C": "Partial ~", "D": "Weak ✗", "F": "Off-target ✗"}
    eval_res["grade_label"] = grade_map.get(eval_res.get("grade", "C"), "~")

    return {
        **eval_res,
        "session_id":     req.session_id,
        "turn":           state.turn_count + 1,
        "completion_pct": cum.get("completion_pct", 0),
        "should_stop":    cum.get("should_stop", False),
        "stop_reason":    cum.get("stop_reason", ""),
    }

class PredictReq(BaseModel):
    text:       str
    api_key:    Optional[str] = None
    session_id: str           = "default"

@app.post("/predict")
async def predict(req: PredictReq):
    """
    Real-time prediction endpoint.
    Returns: spell corrections, intent preview, domain classification.
    Uses sentence-transformers embeddings for domain matching.
    """
    from metrics import ml_score
    text = req.text.strip()
    if not text or len(text) < 4:
        return {"ok": False, "error": "too short"}

    result = {"ok": True, "text": text}

    # Semantic domain classification via embeddings
    try:
        from memory_layer import embed, cosine_sim, HAS_EMBEDDINGS
        if HAS_EMBEDDINGS:
            DOMAIN_ANCHORS = {
                "software":      "build app code website react python javascript typescript api backend frontend",
                "machine_learning": "train model neural network deep learning transformer embeddings dataset",
                "finance":       "invest stocks portfolio crypto money budget savings returns",
                "health":        "exercise diet calories nutrition symptoms medical treatment",
                "mental_health": "anxiety depression therapy stress feelings emotions overwhelmed",
                "fashion":       "outfit style clothing dress wear fashion wardrobe",
                "science":       "experiment hypothesis chemistry physics biology quantum genetics",
                "mathematics":   "equation proof calculus algebra statistics probability matrix",
                "marketing":     "brand campaign launch growth saas gtm audience conversion",
                "creative_writing": "write story poem fiction narrative essay voice tone",
                "cooking":       "recipe ingredient cook bake food meal dish technique",
                "philosophy":    "ethics logic epistemology consciousness meaning existence",
            }
            q_emb = embed(text)
            best_domain, best_score = "general", 0.0
            for domain, anchor in DOMAIN_ANCHORS.items():
                a_emb = embed(anchor)
                sim   = cosine_sim(q_emb, a_emb)
                if sim > best_score:
                    best_score, best_domain = sim, domain
            result["domain"]       = best_domain
            result["domain_score"] = round(best_score, 3)
    except Exception as e:
        result["domain"] = "general"

    # Similar past prompts from chromadb
    try:
        from memory_layer import _chroma_search
        similar = _chroma_search(text, req.session_id, limit=2)
        if similar:
            result["similar_past"] = similar[:2]
    except Exception:
        pass

    return result

@app.post("/signal")
def signal(req: SignalReq):
    """Record an RLHF signal from the browser (Use/Vary/Copy button clicks)."""
    persistent_memory.record_signal(
        req.user_id, req.technique, req.domain,
        req.provider, req.signal, req.weight, req.prompt_snippet or ''
    )
    return {"ok": True}

@app.post("/memory/add")
def memory_add(req: MemoryReq):
    """Explicitly add a memory fact."""
    persistent_memory.remember(req.user_id, req.content, req.metadata)
    return {"ok": True}

@app.get("/memory/recall")
def memory_recall(user_id: str, query: str, limit: int = 5):
    """Retrieve semantically relevant memories for a user."""
    results = persistent_memory.recall(user_id, query, limit)
    return {"ok": True, "memories": results}

@app.get("/memory/stats/{user_id}")
def memory_stats(user_id: str):
    """Memory layer stats for dashboard."""
    return {"ok": True, **persistent_memory.get_stats(user_id)}

@app.get("/health")
def health():
    return {
        "ok": True,
        "groq": bool(os.getenv("GROQ_API_KEY")),
        "sessions": len(memory._store),
        "mem0": True,  # persistent_memory knows
        "version": "3.0"
    }

# ── Install / event tracking ──────────────────────────────────────────────────
TRACK_FILE = os.path.join(os.path.dirname(__file__), 'installs.json')

def _load_track():
    try:
        return json.load(open(TRACK_FILE))
    except Exception:
        return {"installs": 0, "uninstalls": 0, "updates": 0, "events": []}

def _save_track(data):
    # Keep only last 2000 events to prevent file bloat
    data["events"] = data["events"][-2000:]
    json.dump(data, open(TRACK_FILE, 'w'), indent=2)

class TrackReq(BaseModel):
    event:   str           # "install" | "update" | "uninstall" | "active"
    version: str           = "unknown"
    cid:     str           = ""   # anonymous client id (random UUID, no PII)
    country: Optional[str] = None

@app.post("/track")
def track(req: TrackReq):
    data = _load_track()
    event = req.event.lower()
    if event in ("install", "uninstalls", "update"):
        data[event if event != "uninstalls" else "uninstalls"] = data.get(event if event != "uninstalls" else "uninstalls", 0) + 1
    if event == "install":
        data["installs"] = data.get("installs", 0) + 1
    elif event == "uninstall":
        data["uninstalls"] = data.get("uninstalls", 0) + 1
    elif event == "update":
        data["updates"] = data.get("updates", 0) + 1

    data["events"].append({
        "event":   event,
        "version": req.version,
        "cid":     req.cid[:36],   # UUID only, no extra data
        "ts":      int(time.time()),
    })
    _save_track(data)
    return {"ok": True}

@app.get("/stats")
def stats():
    data = _load_track()
    events = data.get("events", [])

    # Unique installs by client id
    unique_installers = len({e["cid"] for e in events if e["event"] == "install" and e.get("cid")})

    # Active last 7 days
    week_ago = time.time() - 7 * 86400
    recent_active = len({e["cid"] for e in events if e["ts"] > week_ago and e["event"] == "active" and e.get("cid")})

    # Version distribution from installs
    versions = {}
    for e in events:
        if e["event"] in ("install", "active"):
            versions[e["version"]] = versions.get(e["version"], 0) + 1

    return {
        "installs":         data.get("installs", 0),
        "uninstalls":       data.get("uninstalls", 0),
        "updates":          data.get("updates", 0),
        "unique_installers": unique_installers,
        "active_7d":        recent_active,
        "total_events":     len(events),
        "version_breakdown": dict(sorted(versions.items(), key=lambda x: -x[1])[:10]),
    }
