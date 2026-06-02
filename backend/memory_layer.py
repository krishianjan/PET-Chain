import os
import json
import sqlite3
from typing import List, Dict
import time

DB_PATH = os.path.join(os.path.dirname(__file__), "pet_memory.db")

class PersistentMemoryLayer:
    """
    Lightweight persistent memory layer inspired by Mem0 and Hermes.
    Extracts and stores user preferences, technical constraints, and long-term context.
    """
    def __init__(self):
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute('''
                CREATE TABLE IF NOT EXISTS preferences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    domain TEXT,
                    preference TEXT,
                    weight REAL,
                    created_at INTEGER
                )
            ''')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS interactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    prompt TEXT,
                    response TEXT,
                    score REAL,
                    created_at INTEGER
                )
            ''')
            conn.commit()

    def add_preference(self, user_id: str, domain: str, preference: str, weight: float = 1.0):
        """Add a learned preference (e.g., 'prefers concise answers', 'uses React')."""
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO preferences (user_id, domain, preference, weight, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, domain, preference, weight, int(time.time()))
            )
            conn.commit()

    def get_preferences(self, user_id: str, domain: str = None) -> List[Dict]:
        """Retrieve stored preferences for prompt augmentation."""
        with sqlite3.connect(DB_PATH) as conn:
            if domain:
                cursor = conn.execute(
                    "SELECT preference, weight FROM preferences WHERE user_id = ? AND (domain = ? OR domain = 'general') ORDER BY weight DESC LIMIT 10",
                    (user_id, domain)
                )
            else:
                cursor = conn.execute(
                    "SELECT preference, weight FROM preferences WHERE user_id = ? ORDER BY weight DESC LIMIT 10",
                    (user_id,)
                )
            return [{"preference": row[0], "weight": row[1]} for row in cursor.fetchall()]

    def log_interaction(self, user_id: str, prompt: str, response: str, score: float):
        """Log an interaction for RLHF and self-improvement."""
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute(
                "INSERT INTO interactions (user_id, prompt, response, score, created_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, prompt, response, score, int(time.time()))
            )
            conn.commit()

    def build_context_block(self, user_id: str, domain: str) -> str:
        """Builds a context block to inject into the LLM prompt."""
        prefs = self.get_preferences(user_id, domain)
        if not prefs:
            return ""
        
        ctx = "USER PREFERENCES (Follow these strictly):\n"
        for p in prefs:
            ctx += f"- {p['preference']}\n"
        return ctx

persistent_memory = PersistentMemoryLayer()
