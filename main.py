from sarvamai import SarvamAI
from sarvamai.core.api_error import ApiError
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import sqlite3
import os
import json
import uuid
from typing import List, Dict, Any

# Import our pipeline functions
from document_processor import extract_text_from_pdf, chunk_text
from rag_engine import build_vector_store, multi_query_search
from llm_extractor import extract_action_plan

app = FastAPI(title="JurisExtract API")

# --- Create uploads folder and serve it to the web ---
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Allow the frontend to talk to this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Setup (SQLite) ---
DB_FILE = "juris_extract.db"

def init_db():
    """Creates the necessary tables if they don't exist."""
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS cases (
            id TEXT PRIMARY KEY,
            filename TEXT,
            summary TEXT,
            status TEXT DEFAULT 'pending_review'
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS action_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT,
            action_type TEXT,  -- <--- NEW FIELD FOR GAP 2
            compliance_action TEXT,
            responsible_department TEXT,
            timeline_days TEXT,
            confidence_score INTEGER,
            verbatim_source_quote TEXT,
            status TEXT DEFAULT 'pending_review',
            FOREIGN KEY(case_id) REFERENCES cases(id)
        )
    ''')
    conn.commit()
    conn.close()

# Run initialization on startup
init_db()

# --- The Core API Endpoint ---
@app.post("/upload-judgment/")
async def upload_judgment(file: UploadFile = File(...)):
    print(f"Received file: {file.filename}")
    
    # Save the uploaded file permanently into the uploads folder
    temp_file_path = f"uploads/{file.filename}"
    with open(temp_file_path, "wb") as buffer:
        buffer.write(await file.read())

    try:
        print("Extracting text and chunking...")
        raw_text = extract_text_from_pdf(temp_file_path)
        my_chunks = chunk_text(raw_text, chunk_size_words=200, overlap_words=30)
        
        print("Building local Vector DB and searching...")
        case_id = str(uuid.uuid4())
        safe_collection_name = f"case_{case_id.replace('-', '')}"
        
        my_collection = build_vector_store(my_chunks, collection_name=safe_collection_name)
        final_context = multi_query_search(my_collection, top_k=3)
        
        print("Generating Action Plan via Groq...")
        action_plan_json = extract_action_plan(final_context)
        
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Save the main case
        cursor.execute("INSERT INTO cases (id, filename, summary) VALUES (?, ?, ?)", 
                       (case_id, file.filename, action_plan_json.case_summary))
        
        # Save the action items (NOW INCLUDES ACTION_TYPE)
        for item in action_plan_json.action_items:
            cursor.execute('''
                INSERT INTO action_items 
                (case_id, action_type, compliance_action, responsible_department, timeline_days, confidence_score, verbatim_source_quote) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                case_id, 
                item.action_type,  
                item.compliance_action, 
                item.responsible_department, 
                item.timeline_days, 
                item.confidence_score, 
                item.verbatim_source_quote
            ))
            
        conn.commit()
        conn.close()

        print(f"Successfully processed {file.filename} and saved to DB.")

        return {
            "status": "success",
            "case_id": case_id,
            "filename": file.filename,
            "data": action_plan_json.model_dump()
        }

    except Exception as e:
        print(f"Error during processing: {e}")
        return {"status": "error", "message": str(e)}

# --- Define the Payload Schema for Verification ---
class VerifyPayload(BaseModel):
    final_items: List[Dict[str, Any]]

# --- The Upgraded Verify Endpoint ---
@app.post("/verify-case/{case_id}")
async def verify_case(case_id: str, payload: VerifyPayload):
    """Syncs the final human-verified items to the database."""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # 1. Mark the main case as verified
        cursor.execute("UPDATE cases SET status = 'verified' WHERE id = ?", (case_id,))
        
        # 2. Delete all the old drafted items for this case
        cursor.execute("DELETE FROM action_items WHERE case_id = ?", (case_id,))
        
        # 3. Re-insert only the ones the user kept (NOW INCLUDES ACTION_TYPE)
        for item in payload.final_items:
            cursor.execute('''
                INSERT INTO action_items 
                (case_id, action_type, compliance_action, responsible_department, timeline_days, confidence_score, verbatim_source_quote, status) 
                VALUES (?, ?, ?, ?, ?, ?, ?, 'verified')
            ''', (
                case_id, 
                item.get("action_type"), 
                item.get("compliance_action"), 
                item.get("responsible_department"), 
                item.get("timeline_days"), 
                item.get("confidence_score"), 
                item.get("verbatim_source_quote")
            ))
            
        conn.commit()
        conn.close()
        return {"status": "success"}
    except Exception as e:
        print(f"Error saving verification: {e}")
        return {"status": "error", "message": str(e)}

# --- Dashboard Fetch Endpoint ---
@app.get("/api/dashboard-data/")
def get_dashboard_data():
    """Fetches all verified action items for the Executive Dashboard."""
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        # Fetch verified items and join with cases to get the filename
        cursor.execute('''
            SELECT 
                a.id, a.action_type, a.compliance_action, a.responsible_department, 
                a.timeline_days, a.confidence_score, c.filename 
            FROM action_items a
            JOIN cases c ON a.case_id = c.id
            WHERE a.status = 'verified'
        ''')
        rows = cursor.fetchall()
        conn.close()

        # Format the SQL rows into a clean flat JSON list for React
        items = []
        for row in rows:
            items.append({
                "id": row[0],
                "action_type": row[1], 
                "compliance_action": row[2],
                "responsible_department": row[3],
                "timeline_days": row[4],
                "confidence_score": row[5],
                "filename": row[6]
            })
            
        return {"status": "success", "data": items}
    except Exception as e:
        print(f"Dashboard Error: {e}")
        return {"status": "error", "message": str(e)}

# --- Define Payload for Translation ---
class TranslateRequest(BaseModel):
    texts: List[str]  # List of English strings to translate
    target_language: str = "kn-IN"

# --- Sarvam AI Translation Proxy Endpoint (SDK Version) ---
@app.post("/api/translate/")
def translate_text(payload: TranslateRequest):
    """
    Securely calls the Sarvam AI SDK to translate administrative text into Kannada.
    """
    sarvam_key = os.getenv("SARVAM_API_KEY")
    if not sarvam_key:
        return {"status": "error", "message": "SARVAM_API_KEY not found in .env"}

    # Initialize the official SDK client
    client = SarvamAI(api_subscription_key=sarvam_key)
    translated_texts = []

    try:
        # Loop through the Action Items and translate them
        for text in payload.texts:
            response = client.text.translate(
                input=text,
                source_language_code="en-IN",
                target_language_code=payload.target_language,
                model="sarvam-translate:v1" # Their latest enterprise translation model
            )
            translated_texts.append(response.translated_text)
            
        return {"status": "success", "translations": translated_texts}
        
    except ApiError as e:
        print(f"Sarvam API Error {e.status_code}: {e.body}")
        return {"status": "error", "message": str(e.body)}
    except Exception as e:
        print(f"System Error: {e}")
        return {"status": "error", "message": str(e)}

# --- Basic Health Check Endpoint ---
@app.get("/")
def read_root():
    return {"status": "online", "message": "JurisExtract API is running!"}