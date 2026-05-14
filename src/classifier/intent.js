const TASK_RULES = {
    // Technical
    code_debug: ['bug', 'error', 'fix', 'broken', 'crash', 'undefined', 'typeerror', 'exception', 'traceback', 'syntax'],
    code_build: ['build', 'implement', 'create', 'function', 'class', 'api', 'endpoint', 'script', 'deploy', 'integrate'],
    code_explain: ['how does', 'what is', 'explain', 'understand', 'difference between', 'when to use', 'why does'],
    math_explain: ['linear algebra', 'calculus', 'derivative', 'integral', 'matrix', 'vector', 'probability', 'statistics', 'theorem', 'proof', 'equation'],
    math_solve: ['solve', 'calculate', 'find x', 'compute', 'evaluate', 'simplify', 'factor', 'differentiate', 'integrate'],

    // Learning / Academic
    study: ['study', 'exam', 'test', 'quiz', 'homework', 'assignment', 'essay', 'notes', 'summarize', 'remember'],
    research: ['research', 'analyze', 'compare', 'pros cons', 'best', 'which is better', 'recommend', 'options'],

    // Creative / Writing
    write_content: ['write', 'draft', 'blog', 'post', 'tweet', 'linkedin', 'caption', 'email', 'letter', 'message'],
    creative: ['story', 'poem', 'creative', 'imagine', 'invent', 'brainstorm', 'ideas', 'concept', 'name'],

    // Decision making
    decide: ['should i', 'which', 'pick', 'choose', 'recommend', 'best option', 'help me decide', 'worth it'],

    // Lifestyle / Non-tech
    cooking: ['recipe', 'cook', 'bake', 'ingredients', 'meal', 'food', 'dish', 'kitchen', 'taste', 'nutrition'],
    health: ['health', 'fitness', 'exercise', 'diet', 'weight', 'doctor', 'symptom', 'medicine', 'sleep', 'stress'],
    beauty: ['skin', 'hair', 'makeup', 'nail', 'fashion', 'style', 'outfit', 'color', 'beauty', 'moisturizer'],
    shopping: ['buy', 'purchase', 'product', 'review', 'price', 'worth', 'compare', 'market', 'fruit', 'vegetable'],
    planning: ['plan', 'schedule', 'organize', 'todo', 'reminder', 'goal', 'habit', 'routine', 'budget', 'manage'],
}

const TECH_SIGNALS = ['python', 'javascript', 'react', 'api', 'database', 'sql', 'docker', 'git', 'node', 'async', 'json', 'http', 'rest', 'graphql']
const STUDENT_SIGNALS = ['homework', 'exam', 'study', 'professor', 'course', 'class', 'school', 'college', 'university', 'assignment']
const HOMEMAKER_SIGNALS = ['recipe', 'cooking', 'home', 'kids', 'budget', 'grocery', 'clean', 'family', 'meal prep']

export function classify(prompt) {
    const lower = prompt.toLowerCase()
    const scores = {}
    for (const [cls, kw] of Object.entries(TASK_RULES)) {
        scores[cls] = kw.filter(k => lower.includes(k)).length
    }
    const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]
    return best[1] > 0 ? best[0] : 'research'
}

export function detectUserLevel(prompt) {
    const lower = prompt.toLowerCase()
    if (TECH_SIGNALS.some(s => lower.includes(s))) return 'technical'
    if (STUDENT_SIGNALS.some(s => lower.includes(s))) return 'student'
    if (HOMEMAKER_SIGNALS.some(s => lower.includes(s))) return 'homemaker'
    return 'general'
}