import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv
from memory_store import memory
from agents import classify_intent_llm, fast_intent_fallback, generate_rewrites, evaluate_response, generate_followup

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
    
    state = memory.get(req.session_id)

    # Option B: LLM semantic classifier first, regex fallback if it fails
    intent = await classify_intent_llm(req.prompt, key)
    if not intent:
        intent = fast_intent_fallback(req.prompt)

    data = await generate_rewrites(req.prompt, intent, key)

    memory.update(req.session_id,
        goal=state.goal or data.get("goal", req.prompt[:60]),
        intent=intent.get("task", "explore"),
        persona=intent.get("techniques", [{}])[0].get("persona", "Expert"),
        prompt_count=state.prompt_count + 1
    )
    return {**data, "intent": intent, "session_id": req.session_id}

@app.post("/evaluate")
async def evaluate(req: EvalReq):
    key = req.api_key or os.getenv("GROQ_API_KEY")
    state = memory.get(req.session_id)
    eval_res = await evaluate_response(req.question, req.response, state, key)
    followup = await generate_followup(req.question, req.response, state, eval_res, key)

    angle_used = followup.get("_angle_used")
    new_followups = state.followups_used + ([angle_used] if angle_used else [])
    memory.update(req.session_id,
        score_history=state.score_history + [eval_res.get("score", 0)],
        last_response=req.response[:400],
        followups_used=new_followups[-6:]  # keep last 6 to prevent any repetition
    )
    grade_map = {"A": "Excellent ✦", "B": "Good ✓", "C": "Partial ~", "D": "Weak ✗", "F": "Off-target ✗"}
    grade_label = grade_map.get(eval_res.get("grade", "C"), "~")
    return {**eval_res, "next_prompt": followup.get("next_prompt") or followup.get("prompt"), "grade_label": grade_label}

@app.get("/health")
def health():
    return {"ok": True, "groq": bool(os.getenv("GROQ_API_KEY")), "sessions": len(memory._store)}
