import fitz  # PyMuPDF
import pytesseract
from PIL import Image
import io

# ⚠️ WINDOWS USERS ONLY: Uncomment and update this path if Python can't find Tesseract
pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

def extract_text_from_pdf(pdf_path: str) -> str:
    """
    Attempts to extract digital text. If the PDF is a scanned image, 
    it automatically falls back to Tesseract OCR.
    """
    doc = fitz.open(pdf_path)
    full_text = ""

    # Attempt 1: Standard Digital Extraction (Lightning Fast)
    for page in doc:
        full_text += page.get_text()

    # If we got text, it's a digital PDF! Return it immediately.
    # We use 50 chars as a buffer in case there are a few stray digital artifacts.
    if len(full_text.strip()) > 50:
        print("Digital PDF detected. Extraction complete.")
        return full_text

    # Attempt 2: OCR Fallback (Slower, but reads images)
    print("⚠️ Scanned PDF detected. Initiating Visual OCR Fallback...")
    full_text = ""
    
    for page in doc:
        # 1. Render the PDF page as a high-resolution image (2x zoom for better reading)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2)) 
        img_bytes = pix.tobytes("png")
        
        # 2. Convert to a Pillow Image
        img = Image.open(io.BytesIO(img_bytes))
        
        # 3. Run Google Tesseract OCR on the image
        page_text = pytesseract.image_to_string(img)
        full_text += page_text + "\n"

    print("OCR Extraction complete.")
    return full_text

def chunk_text(text: str, chunk_size_words: int = 200, overlap_words: int = 30):
    """
    Splits the extracted text into smaller, overlapping chunks for RAG context.
    """
    words = text.split()
    chunks = []
    
    if not words:
        return chunks
        
    for i in range(0, len(words), chunk_size_words - overlap_words):
        chunk = " ".join(words[i:i + chunk_size_words])
        chunks.append(chunk)
        
    return chunks