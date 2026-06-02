import re
from rouge_score import rouge_scorer

try:
    from sentence_transformers import SentenceTransformer, util
    _st_model = SentenceTransformer('all-MiniLM-L6-v2')
    HAS_ST = True
except ImportError:
    HAS_ST = False
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity

_rouge = rouge_scorer.RougeScorer(['rouge1', 'rouge2', 'rougeL'], use_stemmer=True)
_STOP  = {'i','a','an','the','is','are','was','to','of','and','or','in','on',
           'at','for','with','this','it','my','we','do','be','by','you','your',
           'can','will','would','should','could','have','has','had','just','also'}

def _kw(text: str) -> set:
    return {w for w in re.sub(r'[^a-z0-9\s]', ' ', text.lower()).split()
            if len(w) > 2 and w not in _STOP}

def ml_score(question: str, response: str) -> dict:
    """Returns composite 0-100 score using Semantic Embeddings (BERTScore-lite) + ROUGE."""
    if not question or not response or len(response.split()) < 5:
        return {"composite": 0, "coverage": 0.0, "f1": 0.0, "missing_keywords": []}

    rs  = _rouge.score(question, response)
    r1  = rs['rouge1'].fmeasure
    rl  = rs['rougeL'].fmeasure

    sim = 0.0
    if HAS_ST:
        try:
            emb_q = _st_model.encode(question, convert_to_tensor=True)
            emb_r = _st_model.encode(response, convert_to_tensor=True)
            sim = float(util.cos_sim(emb_q, emb_r)[0][0])
        except:
            pass
    else:
        try:
            vec = TfidfVectorizer(stop_words='english', max_features=200)
            mat = vec.fit_transform([question, response])
            sim = float(cosine_similarity(mat[0:1], mat[1:2])[0][0])
        except:
            pass

    # Keyword F1
    q_kw, r_kw = _kw(question), _kw(response)
    tp = len(q_kw & r_kw)
    prec   = tp / max(len(r_kw), 1)
    recall = tp / max(len(q_kw), 1)
    f1     = 2 * prec * recall / max(prec + recall, 0.001)
    missing = list(q_kw - r_kw)

    # Weights: 40% Semantic Sim, 20% ROUGE-1, 15% ROUGE-L, 25% Lexical F1
    base = (sim * 40) + (r1 * 20) + (rl * 15) + (f1 * 25)
    composite = min(98, max(20, int(base)))
    
    return {
        "composite": composite,
        "coverage": round(sim, 3),
        "f1": round(f1, 3),
        "missing_keywords": missing[:5],
        "bert_score_active": HAS_ST
    }
