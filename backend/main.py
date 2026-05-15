import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
from memory_store import memory
from agents import classify_intent_llm, fast_intent_fallback, generate_rewrites, evaluate_response, offline_evaluate

load_dotenv()
app = FastAPI(title="PET API v4")
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

@app.post("/rewrite")
async def rewrite(req: RewriteReq):
    if not req.prompt: raise HTTPException(400, "Prompt required")
    key = req.api_key or os.getenv("GROQ_API_KEY")
    if not key: raise HTTPException(401, "API key required")

    state  = memory.get(req.session_id)
    intent = await classify_intent_llm(req.prompt, key) or fast_intent_fallback(req.prompt)
    data   = await generate_rewrites(req.prompt, intent, key)

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
    new_scores = state.score_history + [eval_res.get("score", 0)]

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

@app.get("/health")
def health():
    return {"ok": True, "groq": bool(os.getenv("GROQ_API_KEY")), "sessions": len(memory._store)}
