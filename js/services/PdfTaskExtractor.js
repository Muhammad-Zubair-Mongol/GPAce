/**
 * PdfTaskExtractor.js
 * 
 * Multimodal PDF Task Extraction Engine for GPAce.
 * 1. Renders PDF pages to images client-side via PDF.js.
 * 2. Analyzes page images using Google Gemini Vision via rotating API keys (GeminiKeyManager).
 * 3. Grounds all extracted items against the user's subjects via SubjectGrounder.
 * 
 * Strict GEMINI.md compliance: pure Vanilla JS, zero inline styles, no Python.
 */

import { subjectGrounder } from './SubjectGrounder.js';

export class PdfTaskExtractor {
  constructor(options = {}) {
    this.keyManager = options.keyManager || null;
    this.pdfjsLib = options.pdfjsLib || null;
    this.modelName = options.modelName || 'gemini-1.5-flash';
  }

  /**
   * Helper to resolve the active GeminiKeyManager instance.
   */
  async _getKeyManager() {
    if (this.keyManager) return this.keyManager;
    if (typeof window !== 'undefined' && window.geminiKeyManager) {
      this.keyManager = window.geminiKeyManager;
      return this.keyManager;
    }
    try {
      const mod = await import('../GeminiKeyManager.js');
      this.keyManager = mod.geminiKeyManager || (typeof window !== 'undefined' ? window.geminiKeyManager : null);
      return this.keyManager;
    } catch (e) {
      console.warn('[PdfTaskExtractor] Failed to import GeminiKeyManager:', e);
      return null;
    }
  }

  /**
   * Helper to ensure PDF.js library is loaded and worker is configured.
   */
  async _ensurePdfJs() {
    if (this.pdfjsLib) return this.pdfjsLib;
    if (typeof window !== 'undefined' && window.pdfjsLib) {
      this.pdfjsLib = window.pdfjsLib;
    } else {
      // Dynamic import or load from vendor
      if (typeof window !== 'undefined') {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'assets/vendor/pdfjs/pdf.min.js';
          script.onload = () => {
            this.pdfjsLib = window.pdfjsLib;
            resolve();
          };
          script.onerror = () => reject(new Error('Failed to load assets/vendor/pdfjs/pdf.min.js'));
          document.head.appendChild(script);
        });
      }
    }

    if (this.pdfjsLib && this.pdfjsLib.GlobalWorkerOptions) {
      this.pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/vendor/pdfjs/pdf.worker.min.js';
    }
    return this.pdfjsLib;
  }

  /**
   * Reads a File or Blob into an ArrayBuffer.
   */
  async _fileToArrayBuffer(file) {
    if (file instanceof ArrayBuffer) return file;
    if (typeof file.arrayBuffer === 'function') {
      return await file.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Renders PDF pages to JPEG base64 strings client-side using offscreen canvas.
   * @param {File|Blob|ArrayBuffer} file - PDF file
   * @param {Function} onProgress - Progress callback
   * @returns {Promise<Array<{ pageNumber: number, base64: string, mimeType: string }>>}
   */
  async renderPagesToImages(file, onProgress = null) {
    const pdfjs = await this._ensurePdfJs();
    if (!pdfjs) throw new Error('PDF.js library is not available');

    const arrayBuffer = await this._fileToArrayBuffer(file);
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    const pageImages = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (onProgress) {
        onProgress({
          stage: 'rendering',
          page: pageNum,
          totalPages: numPages,
          percent: Math.round((pageNum / numPages) * 30),
          message: `Rendering page ${pageNum} of ${numPages}...`
        });
      }

      const page = await pdfDoc.getPage(pageNum);
      // Scale 1.5 gives sharp text rendering without excessive memory
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: ctx,
        viewport
      }).promise;

      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      const base64Data = dataUrl.split(',')[1];

      pageImages.push({
        pageNumber: pageNum,
        base64: base64Data,
        mimeType: 'image/jpeg'
      });

      // Cleanup canvas memory
      canvas.width = 0;
      canvas.height = 0;
    }

    return pageImages;
  }

  /**
   * Calls Gemini Vision API with key rotation for a single rendered page.
   */
  async analyzePageWithGemini(pageImage, userSubjects, keyManager) {
    const subjectsList = userSubjects.map(s => `${s.name} (${s.code})`).join(', ');
    const today = new Date().toISOString().split('T')[0];

    const prompt = `You are an expert academic assistant analyzing a student's document or notes (Page ${pageImage.pageNumber}).
Extract ALL actionable tasks, homework, assignments, readings, quizzes, exams, and project milestones.

Current Date: ${today}
Registered User Subjects: [ ${subjectsList} ]

Instructions:
1. Extract actionable academic tasks from this page.
2. If a task clearly belongs to one of the user's subjects listed above, assign that exact subject name. If not, suggest a concise subject name or "General".
3. Assign a priority: "high" (exams, major project deadlines), "medium" (regular assignments, quizzes), or "low" (readings, revision).
4. If a deadline or date is mentioned, format it as YYYY-MM-DD. Otherwise leave dueDate as null.
5. Estimate duration in minutes (e.g., 30, 45, 60).

STRICT OUTPUT FORMAT:
Output ONLY a valid JSON array of objects with no markdown wrapping, no explanation:
[
  {
    "title": "Task title here",
    "description": "Short description or notes",
    "subject": "Subject Name",
    "priority": "low" | "medium" | "high",
    "dueDate": "YYYY-MM-DD" | null,
    "estimatedMinutes": 45
  }
]`;

    const requestPayload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: pageImage.mimeType,
                data: pageImage.base64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 2048
      }
    };

    // Execute call with smart key rotation and automatic 429 failover
    const responseText = await keyManager.withKeyRotation(async (apiKey) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        const err = new Error(`Gemini API HTTP ${res.status}: ${errorBody}`);
        err.status = res.status;
        throw err;
      }

      const json = await res.json();
      const candidateText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return candidateText;
    }, { label: `PDF Page ${pageImage.pageNumber} Vision Analysis` });

    return this._parseTaskJson(responseText, pageImage.pageNumber);
  }

  /**
   * Safely parses Gemini's text response into an array of task objects.
   */
  _parseTaskJson(text, pageNumber) {
    if (!text) return [];

    let cleaned = text.trim();
    // Strip markdown code fences if present
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) {
        return parsed.map(t => ({
          title: t.title || t.content || 'Untitled Task',
          description: t.description || '',
          subject: t.subject || 'General',
          priority: ['low', 'medium', 'high'].includes((t.priority || '').toLowerCase()) ? t.priority.toLowerCase() : 'medium',
          dueDate: t.dueDate || null,
          estimatedMinutes: Number(t.estimatedMinutes) || 30,
          pageNumber
        }));
      }
    } catch (e) {
      console.warn(`[PdfTaskExtractor] Direct JSON parse failed on page ${pageNumber}, attempting regex array extraction:`, e);
      // Fallback regex array extractor
      const match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (match) {
        try {
          const fallbackParsed = JSON.parse(match[0]);
          if (Array.isArray(fallbackParsed)) {
            return fallbackParsed.map(t => ({
              title: t.title || t.content || 'Untitled Task',
              description: t.description || '',
              subject: t.subject || 'General',
              priority: ['low', 'medium', 'high'].includes((t.priority || '').toLowerCase()) ? t.priority.toLowerCase() : 'medium',
              dueDate: t.dueDate || null,
              estimatedMinutes: Number(t.estimatedMinutes) || 30,
              pageNumber
            }));
          }
        } catch (err2) {}
      }
    }
    return [];
  }

  /**
   * Main end-to-end extraction pipeline:
   * 1. Render PDF to images.
   * 2. Analyze pages via rotating Gemini keys.
   * 3. Ground against user subjects.
   * 
   * @param {File|Blob} file - Uploaded PDF
   * @param {Function} onProgress - Progress reporting callback
   * @returns {Promise<Array>} Grounded candidate tasks
   */
  async extractTasksFromPdf(file, onProgress = null) {
    const keyManager = await this._getKeyManager();
    if (!keyManager) {
      throw new Error('Gemini Key Manager is not available. Configure your Gemini API keys in Settings.');
    }

    const healthyKeys = keyManager.getHealthyKeys();
    if (healthyKeys.length === 0) {
      throw new Error('No valid Gemini API keys configured. Please add keys in Settings or Grind Station.');
    }

    const userSubjects = subjectGrounder.getUserSubjects();

    // Step 1: Render PDF to page images
    const pages = await this.renderPagesToImages(file, onProgress);
    const allRawTasks = [];

    // Step 2: Analyze each page with Gemini Vision using key rotation
    for (let i = 0; i < pages.length; i++) {
      const pageImg = pages[i];
      if (onProgress) {
        onProgress({
          stage: 'analyzing',
          page: pageImg.pageNumber,
          totalPages: pages.length,
          percent: 30 + Math.round(((i + 1) / pages.length) * 60),
          message: `Analyzing page ${pageImg.pageNumber} of ${pages.length} with Gemini...`
        });
      }

      try {
        const pageTasks = await this.analyzePageWithGemini(pageImg, userSubjects, keyManager);
        allRawTasks.push(...pageTasks);
      } catch (err) {
        console.error(`[PdfTaskExtractor] Error analyzing page ${pageImg.pageNumber}:`, err);
        // If one page fails, log and continue with remaining pages
      }
    }

    // Step 3: Ground all tasks strictly against user-defined subjects
    if (onProgress) {
      onProgress({
        stage: 'grounding',
        page: pages.length,
        totalPages: pages.length,
        percent: 95,
        message: 'Grounding extracted tasks against your subjects...'
      });
    }

    const groundedTasks = subjectGrounder.groundAll(allRawTasks);

    if (onProgress) {
      onProgress({
        stage: 'complete',
        percent: 100,
        message: `Extraction complete: ${groundedTasks.length} tasks ready for verification.`
      });
    }

    return groundedTasks;
  }
}

export const pdfTaskExtractor = new PdfTaskExtractor();
if (typeof window !== 'undefined') {
  window.PdfTaskExtractor = PdfTaskExtractor;
  window.pdfTaskExtractor = pdfTaskExtractor;
}
