import { useState, useCallback, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { CheckCircle, XCircle, UploadCloud, AlertTriangle, Target, Loader2, FileText, LayoutDashboard, ShieldCheck, Building2, Calendar, Clock, Tag, Edit3 } from 'lucide-react';
import axios from 'axios';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// Helper to color-code the action types
const getTypeBadgeColor = (type) => {
  if (type === 'Appeal Consideration') return 'bg-orange-100 text-orange-800 border-orange-200';
  if (type === 'Policy Review') return 'bg-purple-100 text-purple-800 border-purple-200';
  return 'bg-emerald-100 text-emerald-800 border-emerald-200'; 
};

// The 22 Scheduled Languages of India (Sarvam API format)
const INDIC_LANGUAGES = [
  { code: "en-IN", name: "English (Original)" },
  { code: "as-IN", name: "Assamese (অসমীয়া)" },
  { code: "bn-IN", name: "Bengali (বাংলা)" },
  { code: "brx-IN", name: "Bodo (बड़ो)" },
  { code: "doi-IN", name: "Dogri (डोगरी)" },
  { code: "gu-IN", name: "Gujarati (ગુજરાતી)" },
  { code: "hi-IN", name: "Hindi (हिन्दी)" },
  { code: "kn-IN", name: "Kannada (ಕನ್ನಡ)" },
  { code: "ks-IN", name: "Kashmiri (کأشُر)" },
  { code: "gom-IN", name: "Konkani (कोंकणी)" },
  { code: "mai-IN", name: "Maithili (मैथिली)" },
  { code: "ml-IN", name: "Malayalam (മലയാളം)" },
  { code: "mni-IN", name: "Manipuri (মৈতৈলোন্)" },
  { code: "mr-IN", name: "Marathi (मराठी)" },
  { code: "ne-IN", name: "Nepali (नेपाली)" },
  { code: "or-IN", name: "Odia (ଓଡ଼ିଆ)" },
  { code: "pa-IN", name: "Punjabi (ਪੰਜਾਬੀ)" },
  { code: "sa-IN", name: "Sanskrit (संस्कृतम्)" },
  { code: "sat-IN", name: "Santali (ᱥᱟᱱᱛᱟᱲᱤ)" },
  { code: "sd-IN", name: "Sindhi (سنڌي)" },
  { code: "ta-IN", name: "Tamil (தமிழ்)" },
  { code: "te-IN", name: "Telugu (ತతెలుగు)" },
  { code: "ur-IN", name: "Urdu (اردو)" }
];

export default function App() {
  const [activeView, setActiveView] = useState("verification");

  const [file, setFile] = useState(null);
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [actionItems, setActionItems] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [selectedQuote, setSelectedQuote] = useState("");
  const [pdfInstance, setPdfInstance] = useState(null);
  const [isSearchingPage, setIsSearchingPage] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [warningMsg, setWarningMsg] = useState("");
  const [currentCaseId, setCurrentCaseId] = useState(null);
  const [caseMetadata, setCaseMetadata] = useState(null);

  const [dashboardData, setDashboardData] = useState([]);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);

  // --- TRANSLATION STATE (Upgraded for 22 Languages) ---
  const [selectedLang, setSelectedLang] = useState("en-IN"); 
  const [translatedItems, setTranslatedItems] = useState({}); // Stores cache: { 'hi-IN': { 'text': 'translated' } }
  const [isTranslating, setIsTranslating] = useState(false);

  const fetchDashboardData = async () => {
    setIsDashboardLoading(true);
    try {
      const response = await axios.get("http://127.0.0.1:8000/api/dashboard-data/");
      if (response.data.status === "success") {
        setDashboardData(response.data.data);
      }
    } catch (err) {
      console.error("Failed to fetch dashboard data", err);
    } finally {
      setIsDashboardLoading(false);
    }
  };

  const handleLanguageChange = async (e) => {
    const targetLang = e.target.value;
    setSelectedLang(targetLang);

    // If English, just revert UI (no API call needed)
    if (targetLang === "en-IN") return;

    // Smart Caching: If we already translated this language, don't hit the API again!
    if (translatedItems[targetLang] && Object.keys(translatedItems[targetLang]).length > 0) return;

    setIsTranslating(true);
    try {
      const textsToTranslate = dashboardData.map(item => item.compliance_action);
      
      const response = await axios.post("http://127.0.0.1:8000/api/translate/", {
        texts: textsToTranslate,
        target_language: targetLang
      });

      if (response.data.status === "success") {
        const translationMap = {};
        dashboardData.forEach((item, index) => {
          translationMap[item.compliance_action] = response.data.translations[index];
        });
        
        // Save the new translations into our cache dictionary
        setTranslatedItems(prev => ({
          ...prev,
          [targetLang]: translationMap
        }));
      }
    } catch (err) {
      console.error("Translation failed", err);
      alert("Failed to connect to Sarvam AI Translation service.");
      setSelectedLang("en-IN"); // Revert on failure
    } finally {
      setIsTranslating(false);
    }
  };

  useEffect(() => {
    if (activeView === "dashboard") {
      fetchDashboardData();
    }
  }, [activeView, isVerified]); 

  const groupedDashboardData = dashboardData.reduce((acc, item) => {
    const dept = item.responsible_department || "Unspecified";
    if (!acc[dept]) acc[dept] = [];
    acc[dept].push(item);
    return acc;
  }, {});

  function onDocumentLoadSuccess(pdfDoc) {
    setPdfInstance(pdfDoc);
    setNumPages(pdfDoc.numPages);
  }

  const handleFileUpload = async (event) => {
    const uploadedFile = event.target.files[0];
    if (!uploadedFile) return;

    setFile(URL.createObjectURL(uploadedFile));
    setIsProcessing(true);
    setErrorMessage(null);
    setActionItems([]);
    setSelectedQuote("");
    setIsVerified(false);
    setPageNumber(1);
    setCaseMetadata(null);

    const formData = new FormData();
    formData.append("file", uploadedFile);

    try {
      const response = await axios.post("http://127.0.0.1:8000/upload-judgment/", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      if (response.data.status === "success") {
        setCaseMetadata(response.data.data);
        setActionItems(response.data.data.action_items);
        setCurrentCaseId(response.data.case_id);
      } else {
        setErrorMessage(response.data.message || "Failed to process document.");
      }
    } catch (err) {
      setErrorMessage("Server error. Make sure FastAPI is running.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCardClick = async (quote) => {
    setSelectedQuote(quote);
    setWarningMsg(""); 
    if (!pdfInstance || !quote) return;
    setIsSearchingPage(true);
    try {
      const cleanSearch = quote.replace(/\s+/g, '').toLowerCase().substring(0, 30);
      for (let i = 1; i <= numPages; i++) {
        const page = await pdfInstance.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join('').replace(/\s+/g, '').toLowerCase();
        if (pageText.includes(cleanSearch)) {
          setPageNumber(i);
          break; 
        }
      }
    } catch (err) {} finally {
      setIsSearchingPage(false);
    }
  };

  const handleReject = () => {
    if (!selectedQuote) {
      setWarningMsg("⚠️ Please select an Action Item to reject first.");
      setTimeout(() => setWarningMsg(""), 3000);
      return;
    }
    const updatedItems = actionItems.filter(item => item.verbatim_source_quote !== selectedQuote);
    setActionItems(updatedItems);
    setSelectedQuote(""); 
    setWarningMsg(""); 
  };

  const handleFieldChange = (index, field, newValue) => {
    const updatedItems = [...actionItems];
    updatedItems[index][field] = newValue;
    setActionItems(updatedItems);
  };

  const handleVerify = async () => {
    try {
      const response = await axios.post(`http://127.0.0.1:8000/verify-case/${currentCaseId}`, {
        final_items: actionItems
      });
      if (response.data.status === "success") {
        setIsVerified(true);
      } else {
        setWarningMsg("⚠️ Database sync failed.");
      }
    } catch (err) {
      setWarningMsg("⚠️ Server error during verification.");
    }
  };

  const textRenderer = useCallback(
    (textItem) => {
      if (!selectedQuote) return textItem.str;
      const cleanQuote = selectedQuote.replace(/\s+/g, '').toLowerCase();
      const cleanItem = textItem.str.replace(/\s+/g, '').toLowerCase();
      if (cleanItem.length >= 8 && cleanQuote.includes(cleanItem)) {
        return `<mark style="background-color: #fde047; color: #000; font-weight: 800; border-radius: 3px; padding: 0 1px; box-shadow: 0 0 4px #fde047;">${textItem.str}</mark>`;
      }
      return textItem.str;
    },
    [selectedQuote]
  );

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      
      <header className="bg-slate-900 text-white border-b border-slate-800 flex items-center justify-between px-6 py-4 shrink-0 z-20 shadow-md">
        <div className="flex items-center gap-3">
          <Target className="w-8 h-8 text-blue-500" />
          <div>
            <h1 className="text-xl font-bold leading-tight">CCMS JurisExtract</h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold">Government of India</p>
          </div>
        </div>
        
        <div className="flex bg-slate-800 p-1 rounded-lg">
          <button 
            onClick={() => setActiveView("verification")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all ${activeView === "verification" ? "bg-blue-600 text-white shadow-sm" : "text-slate-300 hover:text-white hover:bg-slate-700"}`}
          >
            <ShieldCheck className="w-4 h-4" /> Nodal Verification
          </button>
          <button 
            onClick={() => setActiveView("dashboard")}
            className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-all ${activeView === "dashboard" ? "bg-blue-600 text-white shadow-sm" : "text-slate-300 hover:text-white hover:bg-slate-700"}`}
          >
            <LayoutDashboard className="w-4 h-4" /> Executive Dashboard
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">

        {/* VERIFICATION GATEWAY */}
        {activeView === "verification" && (
          <div className="flex h-full animate-in fade-in duration-300">
            <div className="w-1/2 h-full flex flex-col border-r border-slate-200 bg-white shadow-xl z-10 relative">
              <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 flex flex-col">
                
                {!file && !isProcessing && actionItems.length === 0 && (
                  <div className="flex-1 flex flex-col items-center justify-center text-slate-400 opacity-60">
                    <FileText className="w-16 h-16 mb-4 text-slate-300" />
                    <p className="text-lg font-medium">Waiting for document ingestion...</p>
                  </div>
                )}

                {isProcessing && (
                  <div className="flex-1 flex flex-col items-center justify-center text-blue-600 space-y-4">
                    <Loader2 className="w-12 h-12 animate-spin text-blue-500" />
                    <h3 className="text-xl font-bold text-slate-800">Analyzing Judgment...</h3>
                  </div>
                )}

                {errorMessage && (
                  <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                    <p className="font-medium text-sm">{errorMessage}</p>
                  </div>
                )}

                {!isProcessing && actionItems.length > 0 && caseMetadata && (
                  <div className="space-y-6 pb-4">
                    <div className="bg-slate-800 text-white rounded-xl p-5 shadow-lg border border-slate-700">
                      <h2 className="text-xl font-bold text-blue-400 mb-1">{caseMetadata.case_title || "Unknown Case Title"}</h2>
                      <div className="flex flex-wrap gap-4 text-xs font-medium text-slate-300 mb-4 pb-4 border-b border-slate-700">
                        <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 text-slate-400"/> {caseMetadata.date_of_order || "Date Not Specified"}</span>
                        <span className="flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 text-slate-400"/> {caseMetadata.parties_involved || "Parties Not Specified"}</span>
                      </div>
                      <p className="text-sm text-slate-200 leading-relaxed italic border-l-2 border-blue-500 pl-3">
                        "{caseMetadata.case_summary}"
                      </p>
                    </div>

                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-slate-800">Extracted Directives ({actionItems.length})</h3>
                        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-200 px-2 py-0.5 rounded-md"><Edit3 className="w-3 h-3" /> Editable</span>
                      </div>
                      <span className="text-xs font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100">Click an item to locate source</span>
                    </div>

                    {actionItems.map((item, index) => {
                      const isSelected = selectedQuote === item.verbatim_source_quote;
                      return (
                        <div key={index} onClick={() => handleCardClick(item.verbatim_source_quote)} className={`border rounded-xl p-5 shadow-sm transition-all cursor-pointer ${isSelected ? 'bg-blue-50 border-blue-400 ring-2 ring-blue-100' : 'bg-white border-slate-200 hover:border-blue-300'}`}>
                          <div className="flex justify-between items-start mb-4">
                            <div className="flex gap-2 items-center">
                              <span className={`text-xs font-bold px-2.5 py-1 rounded-md ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Item #{index + 1}</span>
                              <select 
                                value={item.action_type}
                                onChange={(e) => handleFieldChange(index, 'action_type', e.target.value)}
                                className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded border outline-none cursor-pointer appearance-none ${getTypeBadgeColor(item.action_type)}`}
                              >
                                <option value="Compliance">Compliance</option>
                                <option value="Appeal Consideration">Appeal Consideration</option>
                                <option value="Policy Review">Policy Review</option>
                                <option value="Other">Other</option>
                              </select>
                            </div>
                            <span className={`flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-md ${item.confidence_score > 85 ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                              {item.confidence_score > 85 ? <CheckCircle className="w-3.5 h-3.5"/> : <AlertTriangle className="w-3.5 h-3.5"/>} {item.confidence_score}%
                            </span>
                          </div>
                          <div className="space-y-4">
                            <div>
                              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Action Required (Click to Edit)</label>
                              <textarea 
                                value={item.compliance_action}
                                onChange={(e) => handleFieldChange(index, 'compliance_action', e.target.value)}
                                className={`w-full text-sm font-semibold bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-0 outline-none resize-none transition-colors ${isSelected ? 'text-blue-900' : 'text-slate-800'}`}
                                rows="2"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Department</label>
                                <input 
                                  type="text"
                                  value={item.responsible_department}
                                  onChange={(e) => handleFieldChange(index, 'responsible_department', e.target.value)}
                                  className="w-full text-sm font-semibold text-slate-700 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-blue-500 focus:ring-0 outline-none transition-colors"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Timeline</label>
                                <input 
                                  type="text"
                                  value={item.timeline_days}
                                  onChange={(e) => handleFieldChange(index, 'timeline_days', e.target.value)}
                                  className="w-full text-sm font-bold text-red-600 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-red-500 focus:ring-0 outline-none transition-colors"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="p-5 border-t border-slate-200 bg-white flex flex-col gap-2 shadow-[0_-10px_15px_-3px_rgba(0,0,0,0.05)]">
                {warningMsg && <div className="text-red-500 text-xs font-bold text-center animate-pulse bg-red-50 py-1 rounded">{warningMsg}</div>}
                {isVerified ? (
                  <div className="bg-green-50 border border-green-200 text-green-700 py-3 rounded-lg flex flex-col items-center justify-center gap-1 animate-pulse">
                    <div className="flex items-center gap-2 font-bold text-lg"><CheckCircle className="w-6 h-6" /> Records Verified</div>
                    <p className="text-xs font-medium text-green-600">Available in Executive Dashboard.</p>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <button onClick={handleReject} className="flex-1 bg-white border border-red-200 text-red-600 py-3 rounded-lg font-semibold flex justify-center items-center gap-2 hover:bg-red-50 transition-colors disabled:opacity-50" disabled={actionItems.length === 0}>
                      <XCircle className="w-5 h-5 text-red-500" /> Reject Selected
                    </button>
                    <button onClick={handleVerify} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-semibold flex justify-center items-center gap-2 hover:bg-blue-700 transition-all shadow-md disabled:opacity-50" disabled={actionItems.length === 0}>
                      <CheckCircle className="w-5 h-5" /> Verify & Approve Remaining
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="w-1/2 h-full bg-slate-200 flex flex-col relative overflow-hidden">
              {!file ? (
                <div className="flex-1 flex flex-col items-center justify-center p-12">
                  <div className="w-full max-w-md bg-white rounded-2xl shadow-sm border border-slate-300 border-dashed p-10 text-center hover:scale-105 transition-transform">
                    <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6"><UploadCloud className="w-10 h-10 text-blue-500" /></div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">Upload Judgment</h3>
                    <p className="text-sm text-slate-500 mb-8">Drop your PDF here to begin AI extraction.</p>
                    <label className="bg-slate-900 text-white px-8 py-3 rounded-lg font-bold cursor-pointer hover:bg-slate-800 transition-colors inline-block shadow-md">
                      Select PDF File
                      <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} />
                    </label>
                  </div>
                </div>
              ) : (
                <div className="flex-1 overflow-y-auto p-8 flex justify-center pb-24">
                  <div className="bg-white shadow-2xl rounded-sm">
                    <Document file={file} onLoadSuccess={onDocumentLoadSuccess}>
                      <Page pageNumber={pageNumber} renderTextLayer={true} renderAnnotationLayer={true} scale={1.3} customTextRenderer={textRenderer} />
                    </Document>
                  </div>
                </div>
              )}

              {file && (
                <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-slate-900/95 backdrop-blur-sm text-white px-6 py-3 rounded-full flex items-center gap-6 shadow-2xl border border-white/10 z-20">
                  <button disabled={pageNumber <= 1 || isSearchingPage} onClick={() => setPageNumber(prev => prev - 1)} className="disabled:opacity-30 hover:text-blue-400 px-2 font-bold text-xl">&larr;</button>
                  <div className="w-40 text-center flex justify-center">
                    {isSearchingPage ? <span className="text-xs font-bold text-yellow-400 animate-pulse flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Locating...</span> : <span className="text-sm font-bold tracking-widest uppercase">Page {pageNumber} of {numPages}</span>}
                  </div>
                  <button disabled={pageNumber >= numPages || isSearchingPage} onClick={() => setPageNumber(prev => prev + 1)} className="disabled:opacity-30 hover:text-blue-400 px-2 font-bold text-xl">&rarr;</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* EXECUTIVE DASHBOARD */}
        {activeView === "dashboard" && (
          <div className="h-full overflow-y-auto bg-slate-100 p-8 animate-in fade-in duration-300">
            <div className="max-w-7xl mx-auto space-y-8">
              
              <div className="flex justify-between items-end">
                <div>
                  <div className="flex items-center gap-4 mb-2">
                    <h2 className="text-3xl font-bold text-slate-900">Verified Action Plans</h2>
                    
                    {/* NEW 22-LANGUAGE DROPDOWN */}
                    <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg p-1 shadow-sm relative">
                      {isTranslating && <Loader2 className="w-4 h-4 text-blue-600 animate-spin absolute -left-6" />}
                      <select 
                        value={selectedLang}
                        onChange={handleLanguageChange}
                        disabled={isTranslating}
                        className="bg-slate-50 text-slate-700 text-sm font-bold py-1.5 px-3 rounded outline-none cursor-pointer hover:bg-slate-100 transition-colors border-none ring-0 appearance-none pr-8"
                      >
                        {INDIC_LANGUAGES.map(lang => (
                          <option key={lang.code} value={lang.code}>
                            {lang.name}
                          </option>
                        ))}
                      </select>
                      {/* Custom dropdown arrow */}
                      <div className="absolute right-3 pointer-events-none text-slate-400">▼</div>
                    </div>
                  </div>
                  
                  {selectedLang !== 'en-IN' ? (
                    <p className="text-blue-600 text-xs font-bold bg-blue-50 px-3 py-1.5 rounded inline-block border border-blue-100">
                      National Translation Mission API Active (Sarvam). Please verify with original English order.
                    </p>
                  ) : (
                    <p className="text-slate-500 mt-1">Department-wise view of pending court directives.</p>
                  )}
                </div>

                <div className="bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-3">
                  <span className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                  </span>
                  <span className="text-sm font-semibold text-slate-700">Database Live Sync</span>
                </div>
              </div>

              {isDashboardLoading ? (
                <div className="flex justify-center items-center py-20"><Loader2 className="w-10 h-10 animate-spin text-blue-500" /></div>
              ) : Object.keys(groupedDashboardData).length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
                  <ShieldCheck className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-slate-700">No Verified Records</h3>
                  <p className="text-slate-500 mt-2">Upload and verify a judgment in the Nodal Gateway to populate this dashboard.</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {Object.entries(groupedDashboardData).map(([department, items], deptIndex) => (
                    <div key={deptIndex} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="bg-slate-800 px-6 py-4 flex items-center gap-3 text-white">
                        <Building2 className="w-6 h-6 text-blue-400" />
                        <h3 className="text-lg font-bold">{department}</h3>
                        <span className="ml-auto bg-slate-700 px-3 py-1 rounded-full text-xs font-bold text-blue-300 border border-slate-600">
                          {items.length} Active Directives
                        </span>
                      </div>
                      
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                            <tr>
                              <th className="px-6 py-4">Action Type</th>
                              <th className="px-6 py-4 w-1/3">Compliance Required</th>
                              <th className="px-6 py-4">Source Case File</th>
                              <th className="px-6 py-4">Deadline</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {items.map((item, itemIndex) => (
                              <tr key={itemIndex} className="hover:bg-blue-50/50 transition-colors">
                                <td className="px-6 py-5">
                                  <span className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold px-2.5 py-1.5 rounded-md border ${getTypeBadgeColor(item.action_type)}`}>
                                    <Tag className="w-3 h-3" /> {item.action_type}
                                  </span>
                                </td>
                                <td className="px-6 py-5">
                                  <p className="font-medium text-slate-800">{item.compliance_action}</p>
                                  {/* RENDER SELECTED INDIC LANGUAGE IF NOT ENGLISH */}
                                  {selectedLang !== 'en-IN' && translatedItems[selectedLang]?.[item.compliance_action] && (
                                    <p className="mt-2 text-sm text-blue-700 font-bold bg-blue-50/50 p-2 border-l-2 border-blue-400 rounded-r-md">
                                      {translatedItems[selectedLang][item.compliance_action]}
                                    </p>
                                  )}
                                </td>
                                <td className="px-6 py-5">
                                  <a 
                                    href={`http://127.0.0.1:8000/uploads/${item.filename}`} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-2 text-blue-600 bg-blue-50 px-3 py-1.5 rounded-md inline-flex w-max border border-blue-200 hover:bg-blue-600 hover:text-white transition-all font-semibold shadow-sm"
                                  >
                                    <FileText className="w-4 h-4" /> View PDF
                                  </a>
                                </td>
                                <td className="px-6 py-5">
                                  <div className="flex items-center gap-2 text-red-700 font-bold bg-red-50 px-3 py-1.5 rounded-md inline-flex border border-red-100">
                                    <Clock className="w-4 h-4" /> {item.timeline_days}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}