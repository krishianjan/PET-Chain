import os, json, hashlib, time
from typing import Optional

# Using in-memory dictionary for caching (Fast & Zero Config)
USE_REDIS = False
_mem = {}  

TTL_REWRITE  = 60 * 60 * 6    # 6 hours
TTL_SESSION  = 60 * 60 * 2    # 2 hours

def _hash(text: str) -> str:
    return hashlib.md5(text.lower().strip().encode()).hexdigest()

def cache_get(key: str) -> Optional[dict]:
    try:
        entry = _mem.get(key)
        if entry and time.time() < entry["exp"]:
            return entry["val"]
        if entry:
            del _mem[key]
        return None
    except:
        return None

def cache_set(key: str, value: dict, ttl: int = TTL_REWRITE):
    try:
        _mem[key] = {"val": value, "exp": time.time() + ttl}
    except:
        pass

def rewrite_key(prompt: str)  -> str: return f"rew:{_hash(prompt)}"
def session_key(sid: str)     -> str: return f"ses:{sid}"
