import time, threading
from typing import Optional

class ThreadState:
    def __init__(self):
        self.goal           = ""
        self.intent         = ""
        self.technique      = ""
        self.persona        = ""
        self.user_level     = "intermediate"
        self.prompt_count   = 0
        self.score_history  = []          # [{"score":72,"ts":1234}]
        self.covered        = []          # topics confirmed covered
        self.missing        = []          # topics still needed
        self.milestones     = []          # completed steps
        self.on_track       = True
        self.last_response  = ""          # last 400 chars of LLM reply
        self.followups_used = []          # prevent repetition
        self.created_at     = time.time()
        self.updated_at     = time.time()

    def to_dict(self):
        return self.__dict__.copy()

    @classmethod
    def from_dict(cls, d):
        s = cls()
        for k, v in d.items():
            if hasattr(s, k):
                setattr(s, k, v)
        return s

class MemoryStore:
    """
    In-memory store with:
    - Per-session isolation
    - Atomic updates via lock
    - Auto-TTL cleanup for memory safety
    """

    TTL_SECONDS = 3600  # 1 hour inactivity clears session

    def __init__(self):
        self._store: dict[str, ThreadState] = {}
        self._lock  = threading.RLock()
        self._start_cleanup()

    def get(self, session_id: str) -> ThreadState:
        with self._lock:
            if session_id not in self._store:
                self._store[session_id] = ThreadState()
            return self._store[session_id]

    def update(self, session_id: str, **kwargs):
        """Atomic update — rolls back on error."""
        with self._lock:
            state = self.get(session_id)
            backup = state.to_dict()
            try:
                for k, v in kwargs.items():
                    if hasattr(state, k):
                        setattr(state, k, v)
                state.updated_at = time.time()
            except Exception:
                self._store[session_id] = ThreadState.from_dict(backup)
                raise

    def clear(self, session_id: str):
        with self._lock:
            self._store.pop(session_id, None)

    def _start_cleanup(self):
        def _cleanup():
            while True:
                time.sleep(600)
                now = time.time()
                with self._lock:
                    stale = [k for k, v in self._store.items()
                             if now - v.updated_at > self.TTL_SECONDS]
                    for k in stale:
                        del self._store[k]
        t = threading.Thread(target=_cleanup, daemon=True)
        t.start()

memory = MemoryStore()
