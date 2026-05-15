import os, re, json, random
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage

FAST_MODEL  = "llama-3-8b-8192"
SMART_MODEL = "llama-3.3-70b-versatile"

def get_llm(api_key: str, temperature: float = 0.7, max_tokens: int = 4000, fast: bool = False):
    return ChatGroq(
        api_key=api_key or os.getenv("GROQ_API_KEY"),
        model_name=FAST_MODEL if fast else SMART_MODEL,
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
    raise ValueError("Cannot extract JSON")

# ── Intent classification (semantic, not regex) ───────────────────────────────

CLASSIFY_SYS = """You are a prompt engineering expert. Classify the user's question and choose 3 techniques.

Return ONLY valid JSON:
{
  "domain": "<specific domain>",
  "sub_domain": "<specific sub-area>",
  "task": "<learn|debug|build|analyze|write|calculate|compare|create|explain>",
  "complexity": <1-10>,
  "techniques": [
    {"name": "<Technique1>", "label": "<emoji + label>", "why": "<why for THIS question>", "persona": "<expert role>"},
    {"name": "<Technique2>", "label": "<emoji + label>", "why": "<why for THIS question>", "persona": "<expert role>"},
    {"name": "<Technique3>", "label": "<emoji + label>", "why": "<why for THIS question>", "persona": "<expert role>"}
  ]
}

Pick 3 DIFFERENT techniques from: Chain-of-Thought, Socratic Method, Feynman Technique, Few-Shot Examples, Tree of Thought, Devil's Advocate, Expert Panel, Comparative Analysis, First Principles, Role Reversal"""

async def classify_intent_llm(prompt: str, api_key: str) -> dict:
    try:
        llm = get_llm(api_key, temperature=0.3, max_tokens=600, fast=True)
        resp = await llm.ainvoke([
            SystemMessage(content=CLASSIFY_SYS),
            HumanMessage(content=f'Classify this question: "{prompt}"')
        ])
        return safe_json(resp.content)
    except Exception as e:
        print(f"[PET] classify failed: {e}")
        return None

def fast_intent_fallback(prompt: str) -> dict:
    lower = prompt.lower()
    if re.search(r'\b(stock|invest|finance|money|crypto|portfolio|roi|bond|etf|dividend|asset|forex)\b', lower):
        return {"domain":"finance","task":"analyze","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Financial Analysis","why":"Step-by-step financial reasoning","persona":"CFA Analyst"},
            {"name":"Few-Shot Examples","label":"🎯 Worked Examples","why":"Real numbers anchor concepts","persona":"Portfolio Manager"},
            {"name":"Devil's Advocate","label":"😈 Bear Case","why":"Stress-tests assumptions","persona":"Risk Analyst"},
        ]}
    if re.search(r'\b(chemistry|chemical|compound|reaction|molecule|atom|biology|physics|quantum|genetics|lab|experiment)\b', lower):
        return {"domain":"science","task":"learn","techniques":[
            {"name":"Socratic Method","label":"🔬 Guided Discovery","why":"Builds lab intuition","persona":"Research Scientist"},
            {"name":"Feynman Technique","label":"📚 First Principles","why":"Explains mechanism deeply","persona":"Science Educator"},
            {"name":"Chain-of-Thought","label":"⛓ Step-by-Step","why":"Shows every reasoning step","persona":"Professor"},
        ]}
    if re.search(r'\b(fix|debug|error|bug|crash|exception|traceback|broken|not working)\b', lower):
        return {"domain":"software","task":"debug","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Root Cause Analysis","why":"Systematic elimination","persona":"Staff Engineer"},
            {"name":"Tree of Thought","label":"🌳 Fix Pathfinder","why":"Immediate vs root fix","persona":"Senior Engineer"},
            {"name":"Few-Shot Examples","label":"⚡ Pattern Fix","why":"Shows bug pattern and fix","persona":"Tech Lead"},
        ]}
    if re.search(r'\b(math|calculate|equation|algebra|calculus|geometry|probability|statistics|proof|integral|derivative)\b', lower):
        return {"domain":"mathematics","task":"calculate","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Show-Every-Step","why":"Visible reasoning per line","persona":"Mathematics Professor"},
            {"name":"Few-Shot Examples","label":"🎯 Worked Examples","why":"Two examples then yours","persona":"Math Tutor"},
            {"name":"Feynman Technique","label":"📚 Build Intuition","why":"Why before how","persona":"Math Educator"},
        ]}
    if re.search(r'\b(write|essay|blog|email|letter|cover letter|resume|article|draft|copy|script|proposal|report)\b', lower):
        return {"domain":"writing","task":"write","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Structure-First","why":"Outline before writing","persona":"Senior Content Strategist"},
            {"name":"Few-Shot Examples","label":"🎯 Style-Matched","why":"Shows target tone first","persona":"Editor"},
            {"name":"Expert Panel","label":"🎓 Multi-Angle Review","why":"Multiple expert voices","persona":"Editorial Panel"},
        ]}
    if re.search(r'\b(build|develop|implement|code|app|website|api|database|deploy|architecture|microservice)\b', lower):
        return {"domain":"software","task":"build","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Spec-First","why":"Design before code","persona":"Senior Architect"},
            {"name":"Tree of Thought","label":"🌳 Multi-Approach","why":"3 paths before committing","persona":"Tech Lead"},
            {"name":"Few-Shot Examples","label":"🎯 Pattern-First","why":"Shows the pattern then applies","persona":"Senior Engineer"},
        ]}
    return {"domain":"general","task":"explore","techniques":[
        {"name":"Chain-of-Thought","label":"⛓ Deep Analysis","why":"Systematic reasoning","persona":"Expert Consultant"},
        {"name":"Devil's Advocate","label":"😈 Contrarian","why":"Challenges assumptions","persona":"Critical Thinker"},
        {"name":"Expert Panel","label":"🎓 Panel View","why":"Multiple specialist angles","persona":"Panel Moderator"},
    ]}

# ── Prompt rewriting ──────────────────────────────────────────────────────────

REWRITE_SYS = """You are a master prompt engineer. Generate 3 DIFFERENT expert prompts for the user's question.

RULES:
- Each prompt uses a DIFFERENT technique (one per prompt, assigned below)
- Each prompt is TAILORED to this SPECIFIC question — not a generic template
- NEVER use software/tech metaphors for non-tech questions
- Each prompt: 150-300 words, starts with expert role, clear sections
- Make each prompt meaningfully different in structure, angle, approach

Return ONLY valid JSON:
{"goal":"<what user wants>","rewrites":[
  {"id":"r1","technique":"<name>","label":"<emoji label>","why":"<why>","prompt":"<full prompt>","recommended":true},
  {"id":"r2","technique":"<name>","label":"<emoji label>","why":"<why>","prompt":"<full prompt>","recommended":false},
  {"id":"r3","technique":"<name>","label":"<emoji label>","why":"<why>","prompt":"<full prompt>","recommended":false}
]}"""

async def generate_rewrites(prompt: str, intent: dict, api_key: str) -> dict:
    techniques = intent.get("techniques", [])
    domain     = intent.get("domain", "general")
    task       = intent.get("task", "explore")

    technique_str = "\n".join([
        f"Technique {i+1}: {t['name']} | Label: {t['label']} | Persona: {t['persona']} | Why: {t['why']}"
        for i, t in enumerate(techniques[:3])
    ])

    user_msg = (
        f'User question: "{prompt}"\n'
        f'Domain: {domain} | Task: {task}\n'
        f'Use these 3 DIFFERENT techniques (one per prompt):\n{technique_str}\n\n'
        f'Generate 3 completely different prompts.'
    )

    try:
        llm = get_llm(api_key, temperature=0.8)
        resp = await llm.ainvoke([SystemMessage(content=REWRITE_SYS), HumanMessage(content=user_msg)])
        data = safe_json(resp.content)
        rewrites = data.get("rewrites", [])
        for i, r in enumerate(rewrites):
            if i < len(techniques):
                r.setdefault("label",     techniques[i].get("label", ""))
                r.setdefault("technique", techniques[i].get("name",  ""))
                r.setdefault("why",       techniques[i].get("why",   ""))
        return data
    except Exception as e:
        print(f"[PET] generate_rewrites failed: {e}")
        return {"goal": prompt[:60], "rewrites": []}

# ── Smart evaluation: cumulative goal-completion tracking ─────────────────────
#
# Core idea: treat the user's GOAL as a checklist.
# On each turn, the model checks which items are now covered and which are missing.
# Score = % of goal elements covered so far (cumulative, not per-response).
# When coverage reaches threshold → signal should_stop = true.
#
# Single LLM call per turn. No vector DB. JSON session state.

EVAL_SYS = """You are an expert goal-completion evaluator for LLM responses.

You receive:
- The user's ORIGINAL GOAL (what they ultimately want to achieve)
- The REQUIRED ELEMENTS for that goal (checklist you must track)
- ALREADY COVERED elements from previous turns
- The LATEST LLM response to evaluate

Your job — check the latest response against the required elements:

1. Which required elements does this response NOW cover? (add to covered)
2. Which required elements are still missing across ALL turns?
3. What is the overall completion % (covered / total required)?
4. Should the user STOP asking follow-ups? (yes if completion >= 85% OR if 3+ turns done with diminishing returns)
5. If NOT stopping: write ONE specific follow-up prompt the user should send
   - Reference actual content/words from the latest response
   - Target the SINGLE most important missing element
   - Be specific — name the gap, ask for the exact thing missing
   - 60-120 words. Write the actual prompt, not a description of it.
6. If STOPPING: write a short completion message explaining what was achieved

SCORING:
- Score = min(95, round(completion_pct * 0.7 + quality_bonus * 0.3))
- quality_bonus (0-100): how well-written/specific/useful the latest response is
- Never score below 20 or above 95

Return ONLY valid JSON:
{
  "newly_covered": ["<element now covered by this response>", ...],
  "still_missing": ["<element not yet addressed>", ...],
  "completion_pct": <0-100>,
  "score": <20-95>,
  "grade": "<A|B|C|D|F>",
  "quality_note": "<one sentence on response quality>",
  "should_stop": <true|false>,
  "stop_reason": "<why stopping, or empty string>",
  "next_prompt": "<the complete follow-up prompt to send, OR completion message if stopping>"
}"""

async def evaluate_response(question: str, response: str, state, api_key: str) -> dict:
    try:
        llm = get_llm(api_key, temperature=0.15, max_tokens=700)

        # Build required elements list from session state (set on first turn)
        required = state.required_elements or []
        covered  = state.covered_elements  or []
        missing  = state.missing_elements  or []
        turn     = getattr(state, 'turn_count', 0)

        user_msg = (
            f'ORIGINAL GOAL: "{state.goal or question}"\n\n'
            f'REQUIRED ELEMENTS ({len(required)} total):\n'
            + (('\n'.join(f'  - {e}' for e in required)) if required else '  (not yet extracted — infer from goal)\n')
            + f'\n\nALREADY COVERED in previous turns ({len(covered)}):\n'
            + (('\n'.join(f'  ✓ {e}' for e in covered)) if covered else '  (none yet — this is turn 1)\n')
            + f'\n\nSTILL MISSING ({len(missing)}):\n'
            + (('\n'.join(f'  ✗ {e}' for e in missing)) if missing else '  (not yet determined)\n')
            + f'\n\nTURN NUMBER: {turn + 1}\n'
            + f'\nLATEST LLM RESPONSE (evaluate this):\n"""\n{response[:2000]}\n"""'
        )

        resp = await llm.ainvoke([SystemMessage(content=EVAL_SYS), HumanMessage(content=user_msg)])
        data = safe_json(resp.content)

        # Merge newly covered into cumulative list
        newly = data.get("newly_covered", [])
        all_covered = list(set(covered + newly))
        still_missing = data.get("still_missing", [])

        # If no required_elements yet, infer them from covered + still_missing
        if not required:
            required = list(set(all_covered + still_missing))

        completion = data.get("completion_pct", 0)
        score      = data.get("score", 50)

        # Ensure fields exist
        data.setdefault("score",          score)
        data.setdefault("grade",          "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 45 else "F")
        data.setdefault("should_stop",    False)
        data.setdefault("stop_reason",    "")
        data.setdefault("next_prompt",    "")
        data.setdefault("completion_pct", completion)
        data.setdefault("quality_note",   "")

        # Force stop if we've done 5+ turns with high coverage
        if turn >= 5 and completion >= 70:
            data["should_stop"] = True
            data["stop_reason"] = "Goal substantially achieved after multiple turns"

        # Attach cumulative state for main.py to persist
        data["_cumulative"] = {
            "required_elements": required,
            "covered_elements":  all_covered,
            "missing_elements":  still_missing,
            "completion_pct":    completion,
            "should_stop":       data["should_stop"],
            "stop_reason":       data["stop_reason"],
        }

        return data

    except Exception as e:
        print(f"[PET] evaluate_response failed: {e}")
        return {
            "score": 50, "grade": "C",
            "newly_covered": [], "still_missing": [],
            "completion_pct": 0, "should_stop": False, "stop_reason": "",
            "quality_note": "Evaluation failed",
            "next_prompt": "Please go deeper with a specific example. Apply every concept step by step and show the exact output.",
            "_cumulative": {}
        }

# ── Offline fallback: lightweight goal-completion without LLM ─────────────────
#
# Uses a decision-tree approach for offline scoring:
# 1. Extract noun phrases from goal → required checklist
# 2. Check which appear in response → covered
# 3. Score = coverage ratio × quality signals
# 4. Stop when coverage > 80% or 4+ turns done

def offline_evaluate(question: str, response: str, state) -> dict:
    import math

    STOP = {'the','a','an','is','are','was','were','be','been','being','have','has','had',
            'do','does','did','will','would','could','should','may','might','shall','to',
            'of','in','on','at','by','for','with','about','as','into','through','after',
            'before','between','and','but','or','so','yet','both','either','neither','not',
            'this','that','these','those','it','its','my','your','his','her','our','their',
            'what','which','who','how','when','where','why','can','i','me','we','you','they'}

    # Extract key noun phrases from goal
    goal = (state.goal or question).lower()
    goal_words = [w for w in re.findall(r'\b[a-z]{3,}\b', goal) if w not in STOP]

    resp_lower = response.lower()
    wc = len(response.split())

    # Check coverage
    covered_w = [w for w in goal_words if w in resp_lower]
    missing_w = [w for w in goal_words if w not in resp_lower]
    hit_rate  = len(covered_w) / max(len(goal_words), 1)

    # Quality signals (domain-agnostic)
    has_structure = bool(re.search(r'\n#{1,3}|\n\*\*|\n-\s|\n\d+\.', response))
    has_examples  = bool(re.search(r'\b(example|instance|such as|e\.g\.|for instance|specifically)\b', response, re.I))
    has_numbers   = bool(re.search(r'\d+', response))
    has_code      = bool(re.search(r'```', response))
    has_steps     = bool(re.search(r'step\s+\d|^\d+\.\s', response, re.I | re.M))

    base = round(hit_rate * 50) + 20
    if wc > 400: base += 12
    elif wc > 200: base += 7
    elif wc > 80: base += 3
    if has_structure: base += 6
    if has_examples:  base += 6
    if has_numbers:   base += 5
    if has_code:      base += 8
    if has_steps:     base += 5

    # Cumulative: use existing covered from state
    prev_covered = getattr(state, 'covered_elements', [])
    all_covered  = list(set(prev_covered + covered_w))
    required     = getattr(state, 'required_elements', []) or goal_words
    completion   = min(100, round(len(all_covered) / max(len(required), 1) * 100))

    # Score blends coverage + quality
    score = min(95, max(20, round(completion * 0.6 + base * 0.4)))
    turn  = getattr(state, 'turn_count', 0)

    # Stop conditions
    should_stop = (completion >= 85) or (turn >= 4 and completion >= 65)
    if should_stop:
        next_prompt = f"✓ Goal complete ({completion}% covered). Your response covers: {', '.join(all_covered[:5])}."
        stop_reason = "Coverage threshold reached"
    elif missing_w:
        top_gap = missing_w[0]
        next_prompt = (
            f'Your response covered {", ".join(covered_w[:3]) if covered_w else "the topic"} well. '
            f'Now address the missing part: please explain "{top_gap}" specifically — '
            f'give a concrete example with actual values or steps, and connect it to what you already covered.'
        )
        stop_reason = ""
    else:
        next_prompt = "Good coverage. Push deeper with a real worked example using specific names, numbers, and steps."
        stop_reason = ""

    grade = "A" if score >= 85 else "B" if score >= 70 else "C" if score >= 55 else "D"
    grade_map = {"A": "Excellent ✦", "B": "Good ✓", "C": "Partial ~", "D": "Weak ✗"}

    return {
        "score": score, "grade": grade,
        "grade_label": grade_map[grade],
        "newly_covered":  covered_w[:4],
        "still_missing":  missing_w[:4],
        "completion_pct": completion,
        "should_stop":    should_stop,
        "stop_reason":    stop_reason,
        "next_prompt":    next_prompt,
        "quality_note":   f"{wc} words, {completion}% goal coverage",
        "_cumulative": {
            "required_elements": required,
            "covered_elements":  all_covered,
            "missing_elements":  missing_w,
            "completion_pct":    completion,
            "should_stop":       should_stop,
            "stop_reason":       stop_reason,
        }
    }
