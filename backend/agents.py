import os, re, json
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from rouge_score import rouge_scorer

def get_llm(api_key: str, temperature: float = 0.7, max_tokens: int = 4000):
    return ChatGroq(
        api_key=api_key or os.getenv("GROQ_API_KEY"),
        model_name="llama-3.3-70b-versatile",
        temperature=temperature,
        max_tokens=max_tokens,
    )

def safe_json(raw: str) -> dict:
    if not raw: raise ValueError("empty response")
    t = raw.strip()
    try: return json.loads(t)
    except: pass
    m = re.search(r'```(?:json)?\s*\n?([\s\S]*?)\n?\s*```', t)
    if m:
        try: return json.loads(m.group(1).strip())
        except: pass
    s, e = t.find('{'), t.rfind('}')
    if s != -1 and e > s:
        candidate = t[s:e+1]
        try: return json.loads(candidate)
        except:
            fixed = re.sub(r',(\s*[}\]])', r'\1', candidate)
            try: return json.loads(fixed)
            except: pass
    raise ValueError(f"Cannot extract JSON")

DECISION_TREE = [
    (["build","create","make","develop","implement","scaffold","deploy","code","app","website"], "coding", "build", "Spec-Driven", "markdown", "Senior Software Architect"),
    (["debug","fix","error","bug","crash","broken","exception","traceback"], "coding", "debug", "Root-Cause", "code", "Staff Engineer"),
    (["explain","what is","how does","how do","teach","learn","understand","tutorial"], "education", "explain", "Socratic", "prose", "Expert Teacher"),
    (["solve","calculate","math","algebra","calculus","equation","geometry"], "math", "solve", "Chain-of-Thought", "markdown", "Mathematics Professor"),
    (["compare","vs","versus","difference","better","which","pros","cons"], "analysis", "compare", "Comparative-Matrix", "table", "Senior Analyst"),
    (["write","essay","blog","email","letter","content","article","post","draft"], "writing", "write", "Style-Guide", "prose", "Senior Content Strategist"),
]

def fast_intent(prompt: str) -> dict | None:
    lower = prompt.lower()
    for keywords, domain, task_type, technique, fmt, persona in DECISION_TREE:
        if any(kw in lower for kw in keywords):
            return { "domain": domain, "task_type": task_type, "complexity": 5, "technique": technique, "output_format": fmt, "persona": persona, "user_level": "intermediate" }
    return None

REWRITE_SYS = """YOU ARE A PROMPT ENGINEER. WRITE DETAILED PROMPTS, NOT ANSWERS.
- Each prompt must be 200-400 words (40+ lines).
- Start with an expert role.
- Use technique: {technique}.
- Persona: {persona}.
- Output ONLY valid JSON: {{"goal":"...","rewrites":[{"id":"r1","label":"...","prompt":"...","why":"...","recommended":true}, ...]}}"""

async def generate_rewrites(prompt: str, intent: dict, api_key: str) -> dict:
    technique, persona, fmt = intent.get("technique"), intent.get("persona"), intent.get("output_format")
    system = REWRITE_SYS.format(technique=technique, persona=persona, output_format=fmt)
    try:
        llm = get_llm(api_key, temperature=0.75)
        resp = await llm.ainvoke([SystemMessage(content=system), HumanMessage(content=f'Create 3 rewrites for: "{prompt}"')])
        data = safe_json(resp.content)
        # Expand short rewrites
        for r in data.get("rewrites", []):
            if len(r["prompt"].split()) < 150:
                exp = await llm.ainvoke([SystemMessage(content="Expand this to 200+ words. Output ONLY expanded prompt."), HumanMessage(content=r["prompt"])])
                r["prompt"] = exp.content.strip()
        return data
    except: return {"goal": prompt[:60], "rewrites": []}

EVAL_SYS = """You are a response quality evaluator. Analyze the LLM response against the user's goal.

Return ONLY valid JSON in this exact format:
{
  "score": <integer 0-100>,
  "grade": "<A|B|C|D|F>",
  "covered": ["<topic or aspect that was well addressed>", ...],
  "missing": ["<important topic that was skipped or insufficient>", ...]
}

Scoring guide:
- 90-100 (A): Complete, accurate, specific with examples, directly answers goal
- 75-89 (B): Good coverage, minor gaps or vague on details
- 60-74 (C): Addresses topic but missing key aspects or too generic
- 45-59 (D): Partial answer, significant gaps
- 0-44 (F): Off-topic, wrong, or unhelpfully brief

covered: list 2-4 things the response DID address well
missing: list 2-4 specific gaps or improvements needed (be concrete)"""

FOLLOWUP_SYS = """You are a prompt engineer creating a FOLLOW-UP PROMPT that the user will inject into the LLM.

Rules:
- Write the COMPLETE follow-up prompt the user will send — not a description of what to ask.
- Reference specific content, numbers, or terms from the response (not generic advice).
- If the score is high (>=75): push deeper — ask for a concrete worked example, edge case, or harder application.
- If the score is low (<75): fill the gaps — ask specifically about what was missing, with a request for step-by-step detail.
- Never repeat the same opener as a previous follow-up. Vary the angle: examples, edge cases, contrast, application, verification.
- 80-150 words. Direct. No preamble like "You could ask..." — just write the prompt itself.
Return ONLY valid JSON: {"next_prompt": "<the complete follow-up prompt>"}"""

async def evaluate_response(question: str, response: str, state, api_key: str) -> dict:
    try:
        llm = get_llm(api_key, temperature=0.1, max_tokens=600)
        user_msg = f'User goal: "{state.goal or question}"\n\nLLM response to evaluate:\n"""\n{response[:1500]}\n"""'
        resp = await llm.ainvoke([SystemMessage(content=EVAL_SYS), HumanMessage(content=user_msg)])
        data = safe_json(resp.content)
        # Ensure required fields exist
        data.setdefault("score", 50)
        data.setdefault("grade", "C")
        data.setdefault("covered", [])
        data.setdefault("missing", [])
        return data
    except Exception as e:
        print(f"[PET] evaluate_response failed: {e}")
        return {"score": 50, "grade": "C", "covered": ["Response provided"], "missing": ["More specific examples needed"]}

async def generate_followup(question: str, response: str, state, eval_data: dict, api_key: str) -> dict:
    try:
        llm = get_llm(api_key, temperature=0.75, max_tokens=400)
        missing = eval_data.get("missing", [])
        covered = eval_data.get("covered", [])
        score   = eval_data.get("score", 50)
        # Detect domain from the question for better follow-ups
        domain_hint = ""
        q_lower = (state.goal or question).lower()
        if any(w in q_lower for w in ["stock","invest","finance","money","crypto","roi","portfolio","dividend"]): domain_hint = "finance"
        elif any(w in q_lower for w in ["debug","fix","error","bug","crash","exception"]): domain_hint = "debugging"
        elif any(w in q_lower for w in ["build","create","code","app","api","function","implement"]): domain_hint = "coding"
        elif any(w in q_lower for w in ["math","calculus","equation","algebra","solve","formula"]): domain_hint = "math"
        elif any(w in q_lower for w in ["learn","explain","what is","how does","teach","understand"]): domain_hint = "learning"
        elif any(w in q_lower for w in ["write","essay","blog","email","article","draft"]): domain_hint = "writing"

        user_msg = (
            f'Original question: "{state.goal or question}"\n'
            f'Domain: {domain_hint or "general"}\n'
            f'Response quality score: {score}/100\n'
            f'What the response covered well: {", ".join(covered[:3]) if covered else "basics"}\n'
            f'What was missing or insufficient: {", ".join(missing[:3]) if missing else "depth and examples"}\n'
            f'Response excerpt (first 600 chars): """\n{response[:600]}\n"""'
        )
        resp = await llm.ainvoke([SystemMessage(content=FOLLOWUP_SYS), HumanMessage(content=user_msg)])
        data = safe_json(resp.content)
        if "next_prompt" not in data and "prompt" in data:
            data["next_prompt"] = data["prompt"]
        return data
    except Exception as e:
        print(f"[PET] generate_followup failed: {e}")
        missing = eval_data.get("missing", [])
        if missing:
            gap = missing[0].strip('"').split('"')[0] if '"' in missing[0] else missing[0]
            return {"next_prompt": f'The response left gaps on {missing[0]}. Please add: (1) the exact definition or formula, (2) a concrete worked example using real values, and (3) the most common mistake people make with this specific concept.'}
        return {"next_prompt": 'Go deeper with a real worked example. Pick a specific real-world case, apply every concept you just explained step by step, and show the exact numbers or code at each stage.'}
