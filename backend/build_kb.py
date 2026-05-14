import chromadb
import json
import os
from sentence_transformers import SentenceTransformer

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KB_PATH = os.path.join(BASE_DIR, "pet_knowledge")
DATA_FILE = os.path.join(BASE_DIR, "intent_knowledge.json")

def build():
    # Load data
    if not os.path.exists(DATA_FILE):
        print(f"❌ Error: {DATA_FILE} not found.")
        return

    with open(DATA_FILE, "r") as f:
        data = json.load(f)

    # Init DB
    client = chromadb.PersistentClient(path=KB_PATH)
    
    # Reset existing collection if it exists
    try:
        client.delete_collection(name="intent_specs")
    except:
        pass
        
    collection = client.create_collection(name="intent_specs")

    # Init Embedder
    print("⏳ Loading embedding model...")
    model = SentenceTransformer('all-MiniLM-L6-v2')

    # Flatten and Index
    ids = []
    documents = []
    metadatas = []

    print("⏳ Processing intents...")
    for cat in data['intents']:
        for sub in cat['subcategories']:
            id_str = f"{cat['category']}_{sub['name']}"
            text = f"{sub['name']} {' '.join(sub['keywords'])}"
            
            ids.append(id_str)
            documents.append(text)
            metadatas.append({
                "category": cat['category'],
                "technique": sub['technique'],
                "format": sub['format'],
                "follow_up": sub['follow_up'],
                "example_rewrite": sub['example_rewrite']
            })

    # Add to collection
    collection.add(
        ids=ids,
        documents=documents,
        metadatas=metadatas,
        embeddings=model.encode(documents).tolist()
    )

    print(f"✅ SUCCESS: Indexed {len(ids)} expert intent templates in {KB_PATH}")

if __name__ == "__main__":
    build()
