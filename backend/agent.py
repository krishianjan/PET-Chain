import os, json, re, asyncio
from groq import AsyncGroq

# ── The most important part: a concrete 45-line example teaches the LLM output length ──

EXAMPLE_SHORT_INPUT = "build a website with animations"
EXAMPLE_LONG_OUTPUT = """ROLE: You are a senior frontend architect and UX engineer with 12 years building
production websites. You specialize in Next.js, Framer Motion, and performance optimization.
You have shipped 50+ animated web applications used by Fortune 500 companies.

CONTEXT: I need to build a high-end animated website for an open-source project.
The site must make a strong first impression, load fast, and work perfectly on mobile.
I am comfortable with JavaScript but new to animation libraries.

GOAL: Create a complete, production-ready animated website from scratch.

TECH STACK (use exactly these):
- Framework: Next.js 14 with App Router + TypeScript
- Styling: Tailwind CSS v3 with custom CSS variables for theming
- Animations: Framer Motion v11 (page transitions, scroll-triggered reveals)
- Components: shadcn/ui for accessible, customizable UI primitives
- Icons: Lucide React
- Fonts: next/font with Inter + Fira Code
- Deployment: Vercel (free tier, zero config)

PAGES TO BUILD:
1. Landing page (/) with:
   - Hero section: animated headline with letter-by-letter reveal, gradient background,
     floating particle effect using CSS keyframes
   - Feature grid: 6 cards with staggered fade-in on scroll, hover lift effect
   - Demo section: screenshot with parallax scroll effect
   - Testimonials: horizontal scroll carousel with touch support
   - CTA: pulsing button with glow animation

2. Documentation (/docs) with:
   - Left sidebar with smooth active-state highlighting
   - Code blocks with Prism.js syntax highlighting and copy button
   - Table of contents that tracks scroll position
   - Previous/Next page navigation

3. Contributors (/contributors) with:
   - GitHub API integration to fetch real contributor data
   - Avatar grid with loading skeleton using shimmer effect
   - Stats bar with counting animation on scroll entry

ANIMATIONS TO IMPLEMENT IN ORDER:
Step 1: Set up AnimatePresence in root layout for page transitions
Step 2: Create useScrollReveal hook using Framer Motion useInView
Step 3: Build AnimatedText component for letter-by-letter hero text
Step 4: Add stagger children to FeatureGrid using variants
Step 5: Implement navbar blur background effect on scroll with useScroll

REQUIREMENTS:
- Fully mobile responsive: test at 320px, 768px, 1024px, 1440px
- Dark/light mode: CSS variables + next-themes, respect prefers-color-scheme
- Performance: images via next/image, code splitting, dynamic imports
- Accessibility: WCAG 2.1 AA, keyboard navigation, aria labels, skip links
- SEO: generateMetadata per page, OpenGraph tags, JSON-LD schema, sitemap
- Core Web Vitals targets: LCP < 2.5s, CLS < 0.1, no forced layout

EXACT FILE STRUCTURE TO CREATE:
app/
  layout.tsx        ← ThemeProvider, fonts, global styles
  page.tsx          ← Landing page assembly
  docs/page.tsx     ← Documentation layout
  contributors/page.tsx
components/
  Hero.tsx          ← Animated hero with Framer Motion
  FeatureGrid.tsx   ← Staggered card grid
  Navbar.tsx        ← Scroll-aware navigation
  AnimatedText.tsx  ← Letter-by-letter text reveal
  ui/               ← shadcn components
lib/
  animations.ts     ← Reusable Framer Motion variants
  github.ts         ← GitHub API helper

FIRST COMMANDS TO RUN:
npx create-next-app@latest my-site --typescript --tailwind --app --src-dir
cd my-site
npm install framer-motion lucide-react next-themes
npx shadcn-ui@latest init

START BY CREATING: app/layout.tsx with ThemeProvider and Navbar,
then app/page.tsx with the animated Hero. Show COMPLETE working TypeScript code
for each file, not pseudocode."""

# ── System prompts ──────────────────────────────────────────────────────────

REWRITE_SYS = f"""You are PET — Strategic Prompt Architect. Transform vague prompts into
professional, detailed prompt specifications that get 10x better LLM responses.

CRITICAL LENGTH REQUIREMENT:
Every rewrite MUST be 40-50 lines minimum. Count lines before outputting.
Under 30 lines = FAILURE. The example below shows EXACTLY the required length and detail.

EXAMPLE INPUT: "{EXAMPLE_SHORT_INPUT}"
EXAMPLE OUTPUT (this is the minimum acceptable length and structure):
{EXAMPLE_LONG_OUTPUT}

YOUR RULES FOR EVERY REWRITE:
1. ROLE: Specific credentials, years of experience, specializations (2-3 lines)
2. CONTEXT: User's situation and constraints (2-3 lines)
3. GOAL: Clear one-line objective
4. TECH/APPROACH: Exact tools, versions, libraries (8-12 bullet points)
5. DETAILED STEPS or FEATURES: Numbered list with sub-bullets (10-15 items)
6. REQUIREMENTS: 8-10 specific constraints (responsive, accessible, performance, etc.)
7. FILE STRUCTURE or OUTPUT FORMAT: Exact files to create or format to follow
8. FIRST COMMANDS or STARTING POINT: Exact first action to take

FORMAT SELECTION:
- build/create/make → Bolt/v0 spec with file structure and commands (like example above)
- explain/teach → 5-step breakdown with analogy, worked example, common mistakes
- research/analyze → structured report with findings, comparison table, recommendations
- debug/fix → root cause analysis, reproduction steps, fix with test case
- compare/decide → comparison table, scoring criteria, recommendation with reasoning
- creative/write → style guide, tone examples, structure, constraints

TECHNIQUE SELECTION (pick what genuinely fits — vary across 3 rewrites):
Chain-of-Thought | Expert Persona | Structured Spec | Implementation-First |
Comparative Analysis | Socratic Teaching | Research Brief | Debug Protocol

The 3 rewrites must use DIFFERENT techniques and different angles on the same goal.
User level detected from vocabulary: adjust complexity accordingly.

Output ONLY valid JSON:
{{"goal":"inferred goal","intent":"build|code|learn|compare|research|debug|create|lifestyle",
"user_level":"beginner|intermediate|expert","format_used":"bolt_v0|code_spec|tutorial|comparison|research|debug|creative",
"rewrites":[
  {{"id":"r1","label":"emoji + technique","prompt":"FULL 40-50 line rewrite","why":"one sentence","recommended":true}},
  {{"id":"r2","label":"emoji + technique","prompt":"FULL 40-50 line rewrite — different technique","why":"one sentence","recommended":false}},
  {{"id":"r3","label":"emoji + technique","prompt":"FULL 40-50 line rewrite — third approach","why":"one sentence","recommended":false}}
]}}"""

FOLLOWUP_SYS = """You generate detailed follow-up prompts after an LLM response.

The follow-up MUST be 20-30 lines minimum and must:
1. Quote or reference a SPECIFIC part of the LLM's response (name it explicitly)
2. Identify the single most important next step toward the user's goal
3. Provide full context so the LLM can continue without asking clarifying questions
4. End with an explicit deliverable (file name, code snippet, format, etc.)
5. NOT use ROLE/GOAL/CONTEXT structure — write as a natural expert continuing a conversation

Structure (write all of these):
- Reference what was covered: "The [specific thing] you outlined in Step [N]..."
- State what's still missing: "However, we still need to implement..."
- Provide full context for the next request
- Specify exact deliverable with format/length/scope
- Include any constraints or requirements from previous context

BAD (3 lines): "Can you show me more about step 2?"
GOOD (20+ lines): "The authentication architecture you described in Step 3 makes sense —
JWT tokens with refresh rotation is the right approach. Now let's implement the complete
auth module. Create the following files with full working code:
1. backend/auth/jwt.py — token generation with RS256 algorithm, 15-min access tokens,
   7-day refresh tokens stored in httpOnly cookies
2. backend/auth/middleware.py — FastAPI dependency that validates Bearer tokens and
   extracts user from database, with proper 401/403 responses
3. backend/auth/routes.py — /auth/login, /auth/refresh, /auth/logout endpoints
4. frontend/hooks/useAuth.ts — React hook managing token state, auto-refresh 2min before expiry
Show complete TypeScript/Python code for each file with error handling..."

Output ONLY valid JSON:
{{"next_prompt":"detailed 20-30 line follow-up prompt","follow_up_type":"implement|deepen|validate|exercise|compare"}}"""

EVALUATE_SYS = """Evaluate LLM response quality against the user's goal.
Be specific and honest. Score 1-10: relevance, completeness, actionability, specificity.
goal_progress = (relevance×0.3 + completeness×0.25 + actionability×0.25 + specificity×0.2) × 10

Output ONLY valid JSON:
{{"goal_progress":0-100,"confidence":"low|medium|high","grade":"A|B|C|D|F",
"scores":{{"relevance":0-10,"completeness":0-10,"actionability":0-10,"specificity":0-10}},
"covered":["specific thing covered in plain English — no ML jargon"],
"missing":["specific gap in plain English"],
"response_quality":"poor|ok|good|excellent","goal_complete":false}}"""

# ── Client ──────────────────────────────────────────────────────────────────

def _client(key):
    return AsyncGroq(api_key=key or os.getenv("GROQ_API_KEY"))

def _parse(text):
    clean = re.sub(r'^```json\s*|\s*```$', '', text, flags=re.MULTILINE).strip()
    match = re.search(r'\{.*\}', clean, re.DOTALL)
    if match:
        clean = match.group(0)
    return json.loads(clean)

async def _call(client, system, user, max_tokens=4000, temperature=0.75):
    r = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        temperature=temperature,
        max_tokens=max_tokens,
        messages=[{"role":"system","content":system},{"role":"user","content":user}]
    )
    return r.choices[0].message.content.strip()

# ── Rewrite ─────────────────────────────────────────────────────────────────

async def rewrite(prompt, api_key=None, chain_context=None, session_id=None,
                  chain_vars=None, chain_mode="value"):
    from cache import cache_get, cache_set, session_key, TTL_SESSION

    full = prompt
    if chain_vars:
        for var_name, var_data in (chain_vars or {}).items():
            if f"${var_name}" in full:
                full = full.replace(f"${var_name}",
                    f"[{var_data.get('label',var_name)} context]:\n{var_data.get('content','')[:600]}")
    if chain_context:
        full = f"[Prior context]:\n{chain_context[:600]}\n\nNew request: {full}"

    similar = _get_similar(prompt, n=2)
    few_shot = ""
    if similar:
        few_shot = "\n\nADDITIONAL EXAMPLES from similar requests:\n"
        for ex in similar:
            rew = ex.get('example_rewrite','')
            if len(rew) > 100:
                few_shot += f"\nUser: \"{ex.get('example_user','')}\"\nRewrite:\n{rew}\n---\n"

    system = REWRITE_SYS + few_shot
    client = _client(api_key)

    try:
        raw  = await _call(client, system, f'Transform this prompt into 3 detailed rewrites: "{full}"',
                           max_tokens=4000, temperature=0.75)
        data = _parse(raw)

        for r in data.get("rewrites", []):
            word_count = len(r["prompt"].split())
            line_count = r["prompt"].count('\n') + 1
            print(f"[PET] rewrite '{r['id']}': {word_count} words, {line_count} lines")
            if word_count < 200 or line_count < 15:
                print(f"[PET] expanding rewrite {r['id']} (too short)")
                expand = await _call(client,
                    "You are a prompt expander. Take this short prompt and expand it to 40-50 lines "
                    "by adding: specific tools/versions, step-by-step breakdown, requirements list, "
                    "file structure, exact commands. Keep the same intent but make it professional "
                    "and detailed. Output ONLY the expanded prompt text, nothing else.",
                    r["prompt"], max_tokens=2500, temperature=0.7)
                r["prompt"] = expand.strip()

        if session_id and data.get("goal"):
            from cache import cache_get as cg, cache_set as cs
            sess = cg(session_key(session_id)) or {}
            sess.update({"goal":data["goal"],"intent":data.get("intent",""),
                         "user_level":data.get("user_level",""),
                         "prompt_count":sess.get("prompt_count",0)+1})
            cs(session_key(session_id), sess, TTL_SESSION)

        return {"ok":True,"rewrites":data["rewrites"],"goal":data.get("goal",""),
                "intent":data.get("intent",""),"user_level":data.get("user_level",""),
                "format_used":data.get("format_used","")}

    except Exception as e:
        print(f"[PET] rewrite error: {e}")
        return {"ok":False,"error":str(e),"rewrites":_fallback(prompt)}


async def evaluate(original_question, response, api_key=None, session_id=None):
    from metrics import ml_score
    from cache import cache_get, cache_set, session_key, TTL_SESSION

    goal, user_level, intent = "", "intermediate", ""
    if session_id:
        sess = cache_get(session_key(session_id)) or {}
        goal       = sess.get("goal","")
        user_level = sess.get("user_level","intermediate")
        intent     = sess.get("intent","")

    ml = ml_score(original_question, response)
    client = _client(api_key)

    try:
        eval_user = f"""Goal: "{goal or original_question}"
Question: "{original_question[:300]}"
Response: "{response[:1200]}"
User level: {user_level}
ML coverage signal: {int(ml['coverage']*100)}%"""

        followup_user = f"""Goal: "{goal or original_question}"
Intent: {intent}, User level: {user_level}
LLM response: "{response[:800]}"
Write a detailed follow-up prompt that continues toward the goal."""

        eval_raw, followup_raw = await asyncio.gather(
            _call(client, EVALUATE_SYS,  eval_user,     max_tokens=500, temperature=0.1),
            _call(client, FOLLOWUP_SYS,  followup_user, max_tokens=1500, temperature=0.6),
        )

        eval_data     = _parse(eval_raw)
        followup_data = _parse(followup_raw)
        prog          = eval_data.get("goal_progress", 0)

        if session_id:
            sess = cache_get(session_key(session_id)) or {}
            sess.setdefault("covered",[]).extend(eval_data.get("covered",[]))
            sess["last_progress"] = prog
            cache_set(session_key(session_id), sess, TTL_SESSION)

        return {
            "goal_progress":    prog,
            "confidence":       eval_data.get("confidence","medium"),
            "grade":            eval_data.get("grade","C"),
            "grade_label":      _grade(eval_data.get("grade","C")),
            "scores":           eval_data.get("scores",{}),
            "covered":          eval_data.get("covered",[]),
            "missing":          eval_data.get("missing",[]),
            "response_quality": eval_data.get("response_quality","ok"),
            "goal_complete":    eval_data.get("goal_complete", prog >= 95),
            "next_prompt":      followup_data.get("next_prompt",""),
            "follow_up_type":   followup_data.get("follow_up_type","continue"),
            "goal":             goal,
            "source":           "llm+ml",
        }

    except Exception as e:
        prog = min(80, ml["composite"])
        q_kw = [w for w in original_question.lower().split()
                if len(w)>3 and w not in {'what','how','when','where','that','this','with'}]
        return {
            "goal_progress":    prog, "confidence":"medium",
            "grade":            "B" if prog>70 else "C",
            "grade_label":      _grade("B" if prog>70 else "C"),
            "scores":{},"covered":["Response provided relevant information"],
            "missing":[f"More detail on: {w}" for w in q_kw[:2]] or ["More specifics needed"],
            "response_quality":"ok","goal_complete":False,
            "next_prompt":"Based on the response, now implement the next concrete step with complete working code and specific file names.",
            "follow_up_type":"implement","goal":goal,"source":"ml_fallback","error":str(e),
        }


def _grade(g):
    return {"A":"Excellent ✦","B":"Good ✓","C":"Partial ~","D":"Weak ✗","F":"Off-target ✗"}.get(g,"~")

def _get_similar(prompt, n=2):
    try:
        import chromadb
        from chromadb.utils import embedding_functions
        client = chromadb.PersistentClient(path="./pet_knowledge")
        col = client.get_collection("intent_examples",
            embedding_function=embedding_functions.SentenceTransformerEmbeddingFunction(
                model_name="all-MiniLM-L6-v2"))
        res = col.query(query_texts=[prompt], n_results=n)
        return res["metadatas"][0] if res["metadatas"] else []
    except:
        return []

def _fallback(prompt):
    lower = prompt.lower()
    is_build = any(w in lower for w in ['build','create','app','website','make','tool'])

    if is_build:
        return [{
            "id":"r1","label":"🚀 Bolt/v0 Full Spec","recommended":True,
            "why":"Complete specification for immediate implementation",
            "prompt": f"""ROLE: You are a senior full-stack engineer with 10+ years building production web applications.
You specialize in modern JavaScript frameworks, cloud deployment, and developer tooling.

CONTEXT: I need to build: {prompt}
I want a production-ready solution that is maintainable, scalable, and follows best practices.

GOAL: Create a complete, working implementation with clear code and explanations.

RECOMMENDED TECH STACK:
- Frontend: Next.js 14 (App Router) + TypeScript
- Styling: Tailwind CSS v3 + shadcn/ui components
- Backend: FastAPI (Python) or Next.js API routes
- Database: PostgreSQL via Prisma ORM
- Auth: NextAuth.js with Google/GitHub OAuth
- Deployment: Vercel (frontend) + Railway (backend) — both free tier

FEATURES TO IMPLEMENT:
1. Core functionality: [primary user action and outcome]
2. User authentication: sign up, login, session management
3. Data persistence: create, read, update, delete operations
4. Responsive design: mobile-first, works on all screen sizes
5. Error handling: loading states, empty states, error boundaries
6. API integration: RESTful endpoints with proper status codes

STEP-BY-STEP IMPLEMENTATION ORDER:
Step 1: Set up Next.js project with TypeScript and Tailwind
Step 2: Design database schema with all required tables and relationships
Step 3: Create API routes for core CRUD operations
Step 4: Build main UI components with proper styling
Step 5: Add authentication flow
Step 6: Connect frontend to API with proper error handling
Step 7: Deploy and configure environment variables

REQUIREMENTS:
- TypeScript strict mode throughout (no any types)
- Environment variables for all secrets (never hardcode)
- Input validation on both frontend and backend
- Responsive design (320px to 1440px)
- Accessible: keyboard navigation, proper aria labels
- Error boundaries to prevent full-page crashes
- Loading skeletons for async data

FILE STRUCTURE:
app/
  layout.tsx, page.tsx, (auth)/login/page.tsx
  api/[entity]/route.ts
components/
  [MainComponent].tsx, ui/
lib/
  db.ts (Prisma), auth.ts, validations.ts
prisma/schema.prisma

COMMANDS TO START:
npx create-next-app@latest project --typescript --tailwind --app
cd project && npm install prisma @prisma/client next-auth
npx prisma init

START WITH: Create the Prisma schema and main page component first."""
        }]
    return []