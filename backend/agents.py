import os, re, json, random
from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from rouge_score import rouge_scorer

# ── Model selection ───────────────────────────────────────────────────────────
# Fast model for classification (low latency, cheap)
FAST_MODEL   = "llama-3-8b-8192"
# Smart model for generation (higher quality prompts)
SMART_MODEL  = "llama-3.3-70b-versatile"

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
    raise ValueError(f"Cannot extract JSON")

# ── OPTION B: LLM-based semantic intent classifier ───────────────────────────
# Replaces regex fast_intent() — understands meaning, not just keywords
# Uses the fast model (llama-3-8b) for speed: ~300ms at Groq

CLASSIFY_SYS = """You are a prompt engineering expert. Analyze the user's question and return a JSON object.

Your job:
1. Identify the TRUE domain (be specific — "organic chemistry" not "science", "machine learning" not "coding")
2. Identify the task type (learn, debug, build, analyze, write, calculate, compare, create, explore)
3. Pick 3 DIFFERENT prompt engineering techniques best suited for this specific question
4. Assign a relevant expert persona for each technique

Available techniques to choose from (pick the 3 BEST for this specific question):
- Chain-of-Thought: step-by-step reasoning, best for complex multi-part problems
- Socratic Method: guided questions, best for learning and understanding
- Feynman Technique: explain simply then deeply, best for concepts
- Few-Shot Examples: show examples then solve, best for skills and patterns
- Tree of Thought: explore multiple approaches, best for open-ended problems
- Devil's Advocate: challenge assumptions, best for analysis and decisions
- Expert Panel: multiple expert perspectives, best for nuanced topics
- Role Reversal: user teaches the AI first, reveals gaps in understanding
- Comparative Analysis: side-by-side comparison, best for choices/tradeoffs
- First Principles: break down to fundamentals, best for building intuition

Return ONLY valid JSON, no explanation:
{
  "domain": "<specific domain>",
  "sub_domain": "<more specific sub-area>",
  "task": "<what the user wants to accomplish>",
  "complexity": <1-10>,
  "techniques": [
    {"name": "<Technique1>", "label": "<emoji + short label>", "why": "<one sentence — why this technique for THIS question>", "persona": "<expert role>"},
    {"name": "<Technique2>", "label": "<emoji + short label>", "why": "<one sentence — why this technique for THIS question>", "persona": "<expert role>"},
    {"name": "<Technique3>", "label": "<emoji + short label>", "why": "<one sentence — why this technique for THIS question>", "persona": "<expert role>"}
  ]
}"""

async def classify_intent_llm(prompt: str, api_key: str) -> dict:
    """LLM-based semantic classifier — no regex, understands meaning."""
    try:
        llm = get_llm(api_key, temperature=0.3, max_tokens=600, fast=True)
        resp = await llm.ainvoke([
            SystemMessage(content=CLASSIFY_SYS),
            HumanMessage(content=f'Classify this question: "{prompt}"')
        ])
        return safe_json(resp.content)
    except Exception as e:
        print(f"[PET] classify_intent_llm failed: {e}")
        return None

# ── Offline regex fallback (only used when LLM classify fails) ───────────────
# Fixed ordering: specific domains checked before generic "build/make"
def fast_intent_fallback(prompt: str) -> dict:
    lower = prompt.lower()
    # Science/STEM first — before code keywords like "make"
    if re.search(r'\b(chemistry|chemical|compound|reaction|molecule|atom|periodic|organic|biochem|lab|experiment|titration|bond|enzyme|protein|dna|rna|genetics|biology|physics|quantum|mechanics|thermodynamics|ecology|geology|astronomy|astrophysics)\b', lower):
        return {"domain":"science","sub_domain":"stem","task":"learn","techniques":[
            {"name":"Socratic Method","label":"🔬 Socratic Scientist","why":"Builds lab intuition through guided questions","persona":"PhD Research Scientist"},
            {"name":"Feynman Technique","label":"📚 Feynman Deep-Dive","why":"Explains mechanism from first principles","persona":"Science Educator"},
            {"name":"Chain-of-Thought","label":"⛓ Step-by-Step Analysis","why":"Shows every reasoning step for complex concepts","persona":"Professor"},
        ]}
    if re.search(r'\b(stock|invest|market|finance|money|crypto|bitcoin|return|profit|loss|portfolio|dividend|equity|fund|trade|roi|bond|etf|share|wealth|budget|saving|bank|interest rate|compound|asset|forex|currency|inflation|recession)\b', lower):
        return {"domain":"finance","sub_domain":"investing","task":"analyze","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Financial Analysis","why":"Step-by-step financial reasoning","persona":"CFA Analyst"},
            {"name":"Few-Shot Examples","label":"🎯 Worked Examples","why":"Real numbers anchor financial concepts","persona":"Portfolio Manager"},
            {"name":"Devil's Advocate","label":"😈 Bear Case","why":"Stress-tests financial assumptions","persona":"Risk Analyst"},
        ]}
    if re.search(r'\b(fix|debug|error|bug|crash|exception|traceback|broken|not working|fails|undefined|null pointer|stack trace|segfault|memory leak|deadlock)\b', lower):
        return {"domain":"software","sub_domain":"debugging","task":"debug","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Root Cause Analysis","why":"Systematic elimination of bug candidates","persona":"Staff Engineer"},
            {"name":"Tree of Thought","label":"🌳 Fix Pathfinder","why":"Explores immediate fix vs root fix vs hardening","persona":"Senior Engineer"},
            {"name":"Few-Shot Examples","label":"⚡ Pattern Fix","why":"Shows the bug pattern and fix pattern side by side","persona":"Tech Lead"},
        ]}
    if re.search(r'\b(math|calculate|equation|algebra|calculus|geometry|probability|statistics|proof|solve|integral|derivative|matrix|formula|arithmetic|linear|differential|topology|number theory|combinatorics)\b', lower):
        return {"domain":"mathematics","sub_domain":"problem solving","task":"calculate","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Step-by-Step Math","why":"Visible reasoning — every line justified","persona":"Mathematics Professor"},
            {"name":"Few-Shot Examples","label":"🎯 Worked Examples","why":"Two similar solved problems then yours","persona":"Math Tutor"},
            {"name":"Feynman Technique","label":"📚 Build Intuition","why":"Why before how — permanent understanding","persona":"Math Educator"},
        ]}
    if re.search(r'\b(health|diet|exercise|medical|disease|symptom|treatment|nutrition|fitness|mental health|therapy|medicine|workout|calories|sleep|supplement|yoga|stress|anxiety|depression|chronic|vaccine|medication|dosage)\b', lower):
        return {"domain":"health","sub_domain":"wellness","task":"learn","techniques":[
            {"name":"Expert Panel","label":"🎓 Medical Panel","why":"Practitioner + researcher + skeptic views","persona":"Medical Expert"},
            {"name":"Socratic Method","label":"🔬 Health Advisor","why":"Diagnoses your specific situation first","persona":"Physician"},
            {"name":"Feynman Technique","label":"📚 Plain English Health","why":"Medical concepts explained simply","persona":"Health Educator"},
        ]}
    if re.search(r'\b(write|essay|blog|email|letter|content|article|draft|copywrite|story|poem|script|copy|caption|headline|newsletter|report|proposal|cover letter|resume|pitch)\b', lower):
        return {"domain":"writing","sub_domain":"content","task":"write","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Structure-First","why":"Outline before writing — pro writers always do this","persona":"Senior Content Strategist"},
            {"name":"Few-Shot Examples","label":"🎯 Style-Matched","why":"Shows the target tone before writing","persona":"Editor"},
            {"name":"Role Reversal","label":"🔄 Editor Mode","why":"AI critiques drafts like a senior editor","persona":"Publishing Editor"},
        ]}
    if re.search(r'\b(build|create|make|develop|implement|code|app|website|api|database|backend|frontend|scaffold|deploy|program|script|function|algorithm|microservice|system design|architecture)\b', lower):
        return {"domain":"software","sub_domain":"development","task":"build","techniques":[
            {"name":"Chain-of-Thought","label":"⛓ Spec-First Architecture","why":"Design before code — prevents costly rework","persona":"Senior Software Architect"},
            {"name":"Tree of Thought","label":"🌳 Multi-Approach Exploration","why":"Explores 3 implementation paths before committing","persona":"Tech Lead"},
            {"name":"Few-Shot Examples","label":"🎯 Pattern-First","why":"Shows the pattern, then applies it to your case","persona":"Senior Engineer"},
        ]}
    if re.search(r'\b(learn|teach|explain|what is|how does|how do|understand|tutorial|concept|beginner|study|course|guide|introduction|overview|primer)\b', lower):
        return {"domain":"education","sub_domain":"learning","task":"learn","techniques":[
            {"name":"Feynman Technique","label":"📚 Feynman Deep-Dive","why":"Build permanent understanding from scratch","persona":"Expert Educator"},
            {"name":"Socratic Method","label":"🔬 Guided Discovery","why":"Questions reveal what you actually need to learn","persona":"Socratic Tutor"},
            {"name":"Expert Panel","label":"🎓 Multiple Perspectives","why":"Practitioner, researcher, and skeptic views combined","persona":"Learning Coach"},
        ]}
    # True general fallback
    return {"domain":"general","sub_domain":"open-ended","task":"explore","techniques":[
        {"name":"Chain-of-Thought","label":"⛓ Deep Analysis","why":"Systematic reasoning through every angle","persona":"Expert Consultant"},
        {"name":"Devil's Advocate","label":"😈 Contrarian View","why":"Challenges assumptions — sharpens thinking","persona":"Critical Thinker"},
        {"name":"Expert Panel","label":"🎓 Expert Panel","why":"Multiple specialist perspectives on your question","persona":"Panel Moderator"},
    ]}

# ── Prompt generation — one custom prompt per technique ───────────────────────

REWRITE_SYS = """You are a master prompt engineer. Generate 3 DIFFERENT expert prompts for the user's question.

CRITICAL RULES:
- Each of the 3 prompts must use a DIFFERENT technique (given in the intent)
- Each prompt must be TAILORED to this SPECIFIC question — not a generic template
- Never use software/tech metaphors (MVP, tech stack, architecture) for non-tech questions
- Each prompt: 150-300 words, starts with relevant expert role, structured with clear sections
- Reference the specific subject matter of the question in the prompt structure
- Make each prompt meaningfully different — different structure, angle, and approach

Return ONLY valid JSON:
{
  "goal": "<what the user wants to achieve in one sentence>",
  "rewrites": [
    {
      "id": "r1",
      "technique": "<technique name>",
      "label": "<emoji + label from intent>",
      "why": "<why this technique for THIS specific question>",
      "prompt": "<the complete rewritten prompt — tailored to the question>",
      "recommended": true
    },
    {
      "id": "r2",
      "technique": "<different technique name>",
      "label": "<emoji + label>",
      "why": "<why>",
      "prompt": "<different approach to same question>",
      "recommended": false
    },
    {
      "id": "r3",
      "technique": "<third different technique name>",
      "label": "<emoji + label>",
      "why": "<why>",
      "prompt": "<third different approach>",
      "recommended": false
    }
  ]
}"""

async def generate_rewrites(prompt: str, intent: dict, api_key: str) -> dict:
    techniques = intent.get("techniques", [])
    domain     = intent.get("domain", "general")
    sub_domain = intent.get("sub_domain", "")
    task       = intent.get("task", "explore")

    technique_str = "\n".join([
        f"Technique {i+1}: {t['name']} | Label: {t['label']} | Persona: {t['persona']} | Why: {t['why']}"
        for i, t in enumerate(techniques[:3])
    ])

    user_msg = (
        f'User question: "{prompt}"\n'
        f'Domain: {domain} ({sub_domain})\n'
        f'Task type: {task}\n'
        f'Use these 3 DIFFERENT techniques (one per prompt):\n{technique_str}\n\n'
        f'Generate 3 completely different prompts, each using its assigned technique.'
    )

    try:
        llm = get_llm(api_key, temperature=0.8)
        resp = await llm.ainvoke([SystemMessage(content=REWRITE_SYS), HumanMessage(content=user_msg)])
        data = safe_json(resp.content)

        # Label each rewrite with the technique metadata from intent
        rewrites = data.get("rewrites", [])
        for i, r in enumerate(rewrites):
            if i < len(techniques):
                r.setdefault("label", techniques[i].get("label", r.get("label", f"Technique {i+1}")))
                r.setdefault("technique", techniques[i].get("name", ""))
                r.setdefault("why", techniques[i].get("why", ""))

        return data
    except Exception as e:
        print(f"[PET] generate_rewrites failed: {e}")
        return {"goal": prompt[:60], "rewrites": []}

# ── Evaluation ────────────────────────────────────────────────────────────────

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

        # Vary follow-up angle based on score and what was already covered
        followups_used = getattr(state, 'followups_used', [])
        angle_options = ["examples", "edge cases", "contrast", "application", "verification", "deeper mechanism", "real data", "counterargument"]
        available_angles = [a for a in angle_options if a not in followups_used]
        angle = available_angles[0] if available_angles else random.choice(angle_options)

        user_msg = (
            f'Original question: "{state.goal or question}"\n'
            f'Response quality score: {score}/100\n'
            f'What was covered well: {", ".join(covered[:3]) if covered else "basics"}\n'
            f'What was missing: {", ".join(missing[:3]) if missing else "depth and examples"}\n'
            f'Angle for this follow-up: {angle}\n'
            f'Previously used angles: {", ".join(followups_used[-3:]) if followups_used else "none"}\n'
            f'Response excerpt: """\n{response[:600]}\n"""'
        )
        resp = await llm.ainvoke([SystemMessage(content=FOLLOWUP_SYS), HumanMessage(content=user_msg)])
        data = safe_json(resp.content)
        if "next_prompt" not in data and "prompt" in data:
            data["next_prompt"] = data["prompt"]
        # Track used angle
        data["_angle_used"] = angle
        return data
    except Exception as e:
        print(f"[PET] generate_followup failed: {e}")
        missing = eval_data.get("missing", [])
        if missing:
            return {"next_prompt": f'The response left gaps on {missing[0]}. Please add: (1) the exact definition or formula, (2) a concrete worked example using real values, and (3) the most common mistake people make with this specific concept.'}
        return {"next_prompt": 'Go deeper with a real worked example. Pick a specific real-world case, apply every concept you just explained step by step, and show the exact numbers or code at each stage.'}
