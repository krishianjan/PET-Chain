"""
PET v3 -- Intelligent Memory Layer

Architecture (three tiers, all properly wired):

  Tier 1 -- Vector Memory (chromadb + sentence-transformers)
    - Real semantic embeddings via all-MiniLM-L6-v2
    - Stores interaction facts, preferences, domain knowledge
    - Retrieval by cosine similarity of embedding vectors
    - Inspired by: github.com/mem0ai/mem0 (same stack, without the API wrapper)

  Tier 2 -- Graph Memory (networkx)
    - Knowledge graph: User -> prefers -> Technique -> for -> Domain
    - Inspired by: github.com/safishamsi/graphify
    - Nodes: users, techniques, domains, providers, concepts
    - Edges weighted by RLHF signal counts + Bayesian update

  Tier 3 -- SQLite
    - Structured interaction log, RLHF signals, preference history
    - Powers analytics / stats endpoint

LLM techniques wired:
  - Embedding-based semantic retrieval (not keyword matching)
  - RLHF signal collection + Bayesian preference update
  - Graph-relational reasoning over user preferences
  - Automatic memory extraction from high-scoring interactions
"""

import os
import json
import sqlite3
import time
import hashlib
from typing import List, Dict, Optional, Tuple

# ── Paths ──────────────────────────────────────────────────────────────────
BACKEND_DIR  = os.path.dirname(__file__)
DB_PATH      = os.path.join(BACKEND_DIR, 'pet_memory.db')
CHROMA_DIR   = os.path.join(BACKEND_DIR, 'pet_memory', 'chroma')
GRAPH_PATH   = os.path.join(BACKEND_DIR, 'pet_memory', 'graph.json')
os.makedirs(os.path.join(BACKEND_DIR, 'pet_memory'), exist_ok=True)

# ── Tier 1A: sentence-transformers (real embeddings) ──────────────────────
try:
    from sentence_transformers import SentenceTransformer, util as st_util
    import numpy as np
    _embed_model = SentenceTransformer('all-MiniLM-L6-v2')
    HAS_EMBEDDINGS = True
    print('[PET memory] sentence-transformers loaded -- real semantic embeddings active')
except ImportError as e:
    HAS_EMBEDDINGS = False
    print(f'[PET memory] sentence-transformers not available: {e}')

def embed(text: str):
    """Embed a string into a float32 vector."""
    if not HAS_EMBEDDINGS:
        return None
    return _embed_model.encode(text, convert_to_numpy=True, normalize_embeddings=True)

def cosine_sim(a, b) -> float:
    """Cosine similarity between two embedding vectors."""
    if a is None or b is None:
        return 0.0
    try:
        import numpy as np
        return float(np.dot(a, b))  # already normalized → dot = cosine
    except Exception:
        return 0.0

# ── Tier 1B: chromadb (vector storage + retrieval) ─────────────────────────
try:
    import chromadb
    _chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
    _collection    = _chroma_client.get_or_create_collection(
        name='pet_memory',
        metadata={'hnsw:space': 'cosine'}
    )
    HAS_CHROMA = True
    print(f'[PET memory] chromadb loaded -- {_collection.count()} vectors stored')
except ImportError as e:
    HAS_CHROMA = False
    print(f'[PET memory] chromadb not available: {e}')

def _chroma_add(doc_id: str, text: str, metadata: dict = None):
    """Add a document to chromadb with its embedding."""
    if not HAS_CHROMA or not HAS_EMBEDDINGS:
        return
    try:
        emb = embed(text).tolist()
        _collection.upsert(
            ids=[doc_id],
            documents=[text],
            embeddings=[emb],
            metadatas=[metadata or {}],
        )
    except Exception as e:
        print(f'[PET chroma add] {e}')

def _chroma_search(query: str, user_id: str, limit: int = 5) -> List[str]:
    """Semantic search in chromadb."""
    if not HAS_CHROMA or not HAS_EMBEDDINGS or _collection.count() == 0:
        return []
    try:
        q_emb   = embed(query).tolist()
        where   = {'user_id': user_id} if user_id else None
        results = _collection.query(
            query_embeddings=[q_emb],
            n_results=min(limit, _collection.count()),
            where=where,
            include=['documents', 'distances'],
        )
        docs = results.get('documents', [[]])[0]
        return [d for d in docs if d]
    except Exception as e:
        print(f'[PET chroma search] {e}')
        return []

# ── Tier 2: Graph Memory (networkx -- inspired by Graphify) ───────────────
try:
    import networkx as nx
    HAS_NETWORKX = True
except ImportError:
    HAS_NETWORKX = False
    print('[PET memory] networkx not available -- using dict graph')

class GraphMemory:
    """
    Knowledge graph for user preference relationships.
    Nodes: user | technique | domain | provider | concept
    Edges: prefers | avoids | uses | active_in | works_well_for

    Inspired by github.com/safishamsi/graphify -- stores relational memory
    as a weighted directed graph with Bayesian edge updates.
    """
    def __init__(self, path: str):
        self.path = path
        if HAS_NETWORKX:
            self.G = nx.DiGraph()
            self._load_nx()
        else:
            self._adj: dict = self._load_dict()

    # ── networkx backend ──────────────────────────────────────────────────
    def _load_nx(self):
        try:
            data = json.load(open(self.path))
            for n, attrs in data.get('nodes', {}).items():
                self.G.add_node(n, **attrs)
            for e in data.get('edges', []):
                self.G.add_edge(e['src'], e['dst'],
                                rel=e['rel'], weight=e['weight'],
                                count=e.get('count', 1),
                                context=e.get('context', ''),
                                updated=e.get('updated', 0))
        except Exception:
            pass

    def _save_nx(self):
        nodes = {n: dict(self.G.nodes[n]) for n in self.G.nodes}
        edges = [{'src': u, 'dst': v, **dict(d)}
                 for u, v, d in self.G.edges(data=True)]
        json.dump({'nodes': nodes, 'edges': edges}, open(self.path, 'w'), indent=2)

    # ── dict fallback backend ─────────────────────────────────────────────
    def _load_dict(self) -> dict:
        try: return json.load(open(self.path))
        except: return {'nodes': {}, 'edges': []}

    def _save_dict(self):
        json.dump(self._adj, open(self.path, 'w'), indent=2)

    # ── Public API ────────────────────────────────────────────────────────
    def add_node(self, node_id: str, node_type: str, attrs: dict = None):
        if HAS_NETWORKX:
            self.G.add_node(node_id, type=node_type, **(attrs or {}))
            self._save_nx()
        else:
            self._adj['nodes'][node_id] = {'type': node_type, **(attrs or {})}
            self._save_dict()

    def add_edge(self, src: str, rel: str, dst: str,
                 weight: float = 1.0, context: str = ''):
        """Add or update an edge with Bayesian weight update."""
        if HAS_NETWORKX:
            if self.G.has_edge(src, dst) and self.G[src][dst].get('rel') == rel:
                old = self.G[src][dst]
                new_w = round(old['weight'] * 0.80 + weight * 0.20, 4)
                self.G[src][dst]['weight'] = new_w
                self.G[src][dst]['count']  = old.get('count', 1) + 1
                self.G[src][dst]['updated'] = int(time.time())
            else:
                self.G.add_edge(src, dst, rel=rel, weight=round(weight, 4),
                                count=1, context=context, updated=int(time.time()))
            self._save_nx()
        else:
            for e in self._adj['edges']:
                if e['src'] == src and e['rel'] == rel and e['dst'] == dst:
                    e['weight'] = round(e['weight'] * 0.80 + weight * 0.20, 4)
                    e['count']  = e.get('count', 1) + 1
                    e['updated'] = int(time.time())
                    self._save_dict()
                    return
            self._adj['edges'].append({'src': src, 'rel': rel, 'dst': dst,
                                       'weight': round(weight, 4), 'count': 1,
                                       'context': context, 'updated': int(time.time())})
            self._save_dict()

    def get_preferences(self, user_id: str, domain: str = None,
                        relations: List[str] = None) -> List[dict]:
        """Get ranked preferences for a user, optionally filtered by domain."""
        rels = set(relations or ['prefers', 'uses', 'works_well_for'])
        results = []
        if HAS_NETWORKX:
            for _, dst, data in self.G.out_edges(user_id, data=True):
                if data.get('rel') not in rels: continue
                if domain and domain not in data.get('context', ''): continue
                results.append({'target': dst, 'relation': data['rel'],
                                'weight': data['weight'], 'count': data.get('count', 1),
                                'context': data.get('context', '')})
        else:
            for e in self._adj.get('edges', []):
                if e['src'] != user_id or e['rel'] not in rels: continue
                if domain and domain not in e.get('context', ''): continue
                results.append({'target': e['dst'], 'relation': e['rel'],
                                'weight': e['weight'], 'count': e.get('count', 1),
                                'context': e.get('context', '')})
        return sorted(results, key=lambda x: x['weight'] * (x['count'] ** 0.5), reverse=True)[:8]

    def get_top_domains(self, user_id: str) -> List[str]:
        if HAS_NETWORKX:
            edges = [(d['dst'], d['weight'])
                     for _, dst, d in self.G.out_edges(user_id, data=True)
                     if d.get('rel') == 'active_in']
        else:
            edges = [(e['dst'], e['weight'])
                     for e in self._adj.get('edges', [])
                     if e['src'] == user_id and e['rel'] == 'active_in']
        return [e[0] for e in sorted(edges, key=lambda x: x[1], reverse=True)[:5]]

    def get_avoided(self, user_id: str) -> List[str]:
        if HAS_NETWORKX:
            return [dst for _, dst, d in self.G.out_edges(user_id, data=True)
                    if d.get('rel') == 'avoids']
        return [e['dst'] for e in self._adj.get('edges', [])
                if e['src'] == user_id and e['rel'] == 'avoids']

    def shortest_path_context(self, user_id: str, domain: str) -> str:
        """Use graph traversal to find indirect preference connections."""
        if not HAS_NETWORKX: return ''
        try:
            paths = nx.single_source_shortest_path(self.G, user_id, cutoff=2)
            connected = [n for n in paths if n != user_id]
            if domain in connected:
                prefs = [dst for _, dst, d in self.G.out_edges(user_id, data=True)
                         if d.get('rel') == 'prefers']
                tech_for_domain = [dst for p in prefs
                                   for _, dst, d in self.G.out_edges(p, data=True)
                                   if domain in d.get('context', '') or dst == domain]
                if tech_for_domain:
                    return f'Graph: {user_id} -> prefers -> {", ".join(prefs[:3])} -> for -> {domain}'
        except Exception:
            pass
        return ''

    def build_context_block(self, user_id: str, domain: str = None) -> str:
        prefs   = self.get_preferences(user_id, domain)
        domains = self.get_top_domains(user_id)
        avoided = self.get_avoided(user_id)
        graph_ctx = self.shortest_path_context(user_id, domain or '')

        if not prefs and not domains:
            return ''
        lines = ['USER GRAPH MEMORY (apply to prompt generation):']
        if domains:
            lines.append(f'  Expert domains: {", ".join(domains)}')
        for p in prefs[:5]:
            lines.append(f'  {p["relation"]}: {p["target"]} (score={p["weight"]:.2f}, used={p["count"]}x, ctx={p["context"][:40]})')
        if avoided:
            lines.append(f'  Avoids: {", ".join(avoided[:3])}')
        if graph_ctx:
            lines.append(f'  {graph_ctx}')
        return '\n'.join(lines)

    @property
    def node_count(self) -> int:
        return self.G.number_of_nodes() if HAS_NETWORKX else len(self._adj.get('nodes', {}))

    @property
    def edge_count(self) -> int:
        return self.G.number_of_edges() if HAS_NETWORKX else len(self._adj.get('edges', []))


_graph = GraphMemory(GRAPH_PATH)

# ── Tier 3: SQLite ─────────────────────────────────────────────────────────
def _init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS interactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT, prompt TEXT, response TEXT,
                domain TEXT, technique TEXT, provider TEXT,
                score REAL, signal TEXT DEFAULT "neutral",
                embedding_id TEXT,
                created_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS rlhf_signals (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT, technique TEXT, domain TEXT,
                provider TEXT, signal TEXT, weight REAL,
                prompt_snippet TEXT, created_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS preferences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT, domain TEXT, preference TEXT,
                weight REAL DEFAULT 1.0, count INTEGER DEFAULT 1,
                created_at INTEGER, updated_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_inter_user ON interactions(user_id);
            CREATE INDEX IF NOT EXISTS idx_rlhf_user  ON rlhf_signals(user_id);
            CREATE INDEX IF NOT EXISTS idx_pref_user  ON preferences(user_id);
        ''')
        conn.commit()

_init_db()


# ── Main interface ─────────────────────────────────────────────────────────
class PETMemory:
    """
    Unified intelligent memory. Routes to best available tier automatically.

    LLM techniques used:
    - Embedding-based semantic retrieval (sentence-transformers all-MiniLM-L6-v2)
    - Bayesian preference update on RLHF signals
    - Graph-relational reasoning (networkx shortest path for indirect prefs)
    - Automatic fact extraction from high-quality interactions
    - Multi-tier fallback: chromadb -> graph -> SQLite
    """

    def remember(self, user_id: str, content: str, metadata: dict = None):
        """Store a memory fact with its embedding."""
        metadata = metadata or {}
        metadata['user_id'] = user_id
        metadata['created'] = int(time.time())

        # Tier 1: chromadb with real embedding
        doc_id = hashlib.md5(f'{user_id}:{content}'.encode()).hexdigest()
        _chroma_add(doc_id, content, metadata)

        # Tier 3: SQLite preference log
        domain = metadata.get('domain', 'general')
        self._upsert_preference(user_id, domain, content)

    def recall(self, user_id: str, query: str, limit: int = 5) -> List[str]:
        """
        Semantic retrieval. Uses real cosine similarity on embeddings.
        Falls back through tiers if vector search not available.
        """
        # Tier 1: chromadb semantic search
        results = _chroma_search(query, user_id, limit)
        if results:
            return results

        # Tier 2: graph context
        graph_prefs = _graph.get_preferences(user_id)
        if graph_prefs:
            candidates = [p['target'] for p in graph_prefs]
            # Re-rank by embedding similarity if available
            if HAS_EMBEDDINGS and candidates:
                q_emb = embed(query)
                scored = []
                for c in candidates:
                    c_emb = embed(c)
                    scored.append((c, cosine_sim(q_emb, c_emb)))
                scored.sort(key=lambda x: x[1], reverse=True)
                return [s[0] for s in scored[:limit]]
            return candidates[:limit]

        # Tier 3: SQLite keyword fallback
        with sqlite3.connect(DB_PATH) as conn:
            rows = conn.execute(
                'SELECT preference FROM preferences WHERE user_id=? ORDER BY weight DESC LIMIT 20',
                (user_id,)
            ).fetchall()
        return [r[0] for r in rows[:limit]]

    def record_signal(self, user_id: str, technique: str, domain: str,
                      provider: str, signal: str, weight: float,
                      prompt_snippet: str = ''):
        """
        Record RLHF signal and update all memory tiers.
        Uses Bayesian weight update: new_w = old_w * 0.80 + signal_w * 0.20
        """
        rel = 'prefers' if signal == 'positive' else ('avoids' if signal == 'negative' else 'uses')

        # Tier 2: graph update
        _graph.add_node(user_id,  'user')
        _graph.add_node(technique, 'technique')
        _graph.add_node(domain,    'domain')
        _graph.add_node(provider,  'provider')
        _graph.add_edge(user_id,   rel,              technique, weight,        f'domain:{domain}')
        _graph.add_edge(user_id,   'active_in',      domain,    weight * 0.40)
        _graph.add_edge(user_id,   'uses_provider',  provider,  weight * 0.20)
        _graph.add_edge(technique, 'works_well_for', domain,    weight * 0.30)

        # Tier 3: SQLite signal log
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                'INSERT INTO rlhf_signals (user_id,technique,domain,provider,signal,weight,prompt_snippet,created_at) VALUES (?,?,?,?,?,?,?,?)',
                (user_id, technique, domain, provider, signal, weight, prompt_snippet[:200], int(time.time()))
            )
            conn.commit()

        # Tier 1: store positive signals as semantic facts
        if signal in ('positive', 'copy') and prompt_snippet:
            fact = f'User responded well to {technique} for {domain}: "{prompt_snippet[:120]}"'
            self.remember(user_id, fact, {'domain': domain, 'type': 'rlhf_positive', 'technique': technique})

    def log_interaction(self, user_id: str, prompt: str, response: str,
                        score: float, domain: str = 'general',
                        technique: str = '', provider: str = ''):
        """Log interaction + auto-extract memory from high-quality responses."""
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                'INSERT INTO interactions (user_id,prompt,response,domain,technique,provider,score,created_at) VALUES (?,?,?,?,?,?,?,?)',
                (user_id, prompt[:400], response[:800], domain, technique, provider, score, int(time.time()))
            )
            conn.commit()

        # Auto-extract memory from high-scoring interactions (score >= 80)
        if score >= 80 and prompt:
            fact = f'High-quality {domain} interaction: "{prompt[:120]}" scored {score}%'
            self.remember(user_id, fact, {
                'domain': domain, 'type': 'high_quality_interaction', 'score': str(score)
            })

    def build_context_block(self, user_id: str, domain: str = None,
                            query: str = None) -> str:
        """
        Build full context block for prompt augmentation.
        Combines: semantic recall + graph preferences + domain expertise.
        """
        parts = []

        # Graph memory (relational preferences)
        graph_ctx = _graph.build_context_block(user_id, domain)
        if graph_ctx:
            parts.append(graph_ctx)

        # Semantic recall (chromadb embeddings)
        if query and (HAS_CHROMA or HAS_EMBEDDINGS):
            memories = self.recall(user_id, query, limit=3)
            if memories:
                parts.append('SEMANTIC MEMORY (relevant past context):\n' +
                             '\n'.join(f'  - {m}' for m in memories))

        # SQLite preferences (fallback)
        if not parts:
            prefs = self.get_preferences(user_id, domain)
            if prefs:
                parts.append('USER PREFERENCES:\n' +
                             '\n'.join(f'  - {p["preference"]}' for p in prefs[:5]))

        return '\n\n'.join(parts)

    def get_preferences(self, user_id: str, domain: str = None) -> List[Dict]:
        with sqlite3.connect(DB_PATH) as conn:
            if domain:
                rows = conn.execute(
                    'SELECT preference, weight FROM preferences WHERE user_id=? AND (domain=? OR domain="general") ORDER BY weight DESC LIMIT 8',
                    (user_id, domain)
                ).fetchall()
            else:
                rows = conn.execute(
                    'SELECT preference, weight FROM preferences WHERE user_id=? ORDER BY weight DESC LIMIT 8',
                    (user_id,)
                ).fetchall()
        return [{'preference': r[0], 'weight': r[1]} for r in rows]

    def get_stats(self, user_id: str) -> dict:
        with sqlite3.connect(DB_PATH) as conn:
            n_inter = conn.execute('SELECT COUNT(*) FROM interactions WHERE user_id=?', (user_id,)).fetchone()[0]
            n_rlhf  = conn.execute('SELECT COUNT(*) FROM rlhf_signals WHERE user_id=?', (user_id,)).fetchone()[0]
            top_t   = conn.execute(
                'SELECT technique, COUNT(*) c FROM rlhf_signals WHERE user_id=? AND signal="positive" GROUP BY technique ORDER BY c DESC LIMIT 1',
                (user_id,)
            ).fetchone()
        return {
            'interactions':       n_inter,
            'rlhf_signals':       n_rlhf,
            'top_technique':      top_t[0] if top_t else None,
            'active_domains':     _graph.get_top_domains(user_id),
            'graph_nodes':        _graph.node_count,
            'graph_edges':        _graph.edge_count,
            'chroma_vectors':     _collection.count() if HAS_CHROMA else 0,
            'embeddings_active':  HAS_EMBEDDINGS,
            'chroma_active':      HAS_CHROMA,
            'networkx_active':    HAS_NETWORKX,
        }

    def _upsert_preference(self, user_id: str, domain: str, preference: str, weight: float = 1.0):
        with sqlite3.connect(DB_PATH) as conn:
            existing = conn.execute(
                'SELECT id, weight, count FROM preferences WHERE user_id=? AND domain=? AND preference=?',
                (user_id, domain, preference)
            ).fetchone()
            now = int(time.time())
            if existing:
                new_w = round(existing[1] * 0.9 + weight * 0.1, 4)
                conn.execute('UPDATE preferences SET weight=?, count=?, updated_at=? WHERE id=?',
                             (new_w, existing[2] + 1, now, existing[0]))
            else:
                conn.execute(
                    'INSERT INTO preferences (user_id,domain,preference,weight,count,created_at,updated_at) VALUES (?,?,?,1,1,?,?)',
                    (user_id, domain, preference, now, now)
                )
            conn.commit()


persistent_memory = PETMemory()
