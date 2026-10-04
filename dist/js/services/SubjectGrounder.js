/**
 * SubjectGrounder.js
 * 
 * Grounds AI-extracted tasks against user-defined academic subjects in GPAce.
 * Retrieves registered subjects from localStorage, semester services, and existing tasks,
 * and performs multi-tier matching (exact, code, alias, word-boundary) to ensure
 * all imported tasks are grounded in the user's curriculum.
 * 
 * Strict GEMINI.md compliance: pure Vanilla JS, zero external frameworks.
 */

export class SubjectGrounder {
  constructor(options = {}) {
    this.storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  }

  /**
   * Retrieves all user-registered subjects across GPAce storage systems.
   * Checks 'academicSubjects', 'semesters', and 'subjects'.
   * @returns {Array<{ id: string, name: string, code: string }>}
   */
  getUserSubjects() {
    const subjectsMap = new Map();

    if (!this.storage) {
      return [{ id: 'general', name: 'General', code: 'GEN' }];
    }

    // 1. Try 'academicSubjects'
    try {
      const raw = this.storage.getItem('academicSubjects');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((s, idx) => {
            const name = typeof s === 'string' ? s.trim() : (s.name || s.title || s.subjectName || '').trim();
            const code = typeof s === 'object' ? (s.code || s.tag || '').trim() : '';
            if (name) {
              const key = name.toLowerCase();
              if (!subjectsMap.has(key)) {
                subjectsMap.set(key, {
                  id: (s && s.id) ? String(s.id) : `subj_${idx + 1}`,
                  name,
                  code: code || this._generateCode(name)
                });
              }
            }
          });
        }
      }
    } catch (e) {
      console.warn('[SubjectGrounder] Error reading academicSubjects:', e);
    }

    // 2. Try 'semesters' structure
    try {
      const rawSemesters = this.storage.getItem('semesters');
      if (rawSemesters) {
        const parsedSem = JSON.parse(rawSemesters);
        if (parsedSem && typeof parsedSem === 'object') {
          Object.values(parsedSem).forEach(sem => {
            if (sem && Array.isArray(sem.subjects)) {
              sem.subjects.forEach((s, idx) => {
                const name = (s.name || s.title || '').trim();
                const code = (s.code || s.tag || '').trim();
                if (name) {
                  const key = name.toLowerCase();
                  if (!subjectsMap.has(key)) {
                    subjectsMap.set(key, {
                      id: s.id ? String(s.id) : `sem_subj_${idx + 1}`,
                      name,
                      code: code || this._generateCode(name)
                    });
                  }
                }
              });
            }
          });
        }
      }
    } catch (e) {
      console.warn('[SubjectGrounder] Error reading semesters:', e);
    }

    // 3. Try legacy 'subjects'
    try {
      const rawSubj = this.storage.getItem('subjects');
      if (rawSubj) {
        const parsedSubj = JSON.parse(rawSubj);
        if (Array.isArray(parsedSubj)) {
          parsedSubj.forEach((s, idx) => {
            const name = typeof s === 'string' ? s.trim() : (s.name || '').trim();
            if (name) {
              const key = name.toLowerCase();
              if (!subjectsMap.has(key)) {
                subjectsMap.set(key, {
                  id: `legacy_${idx + 1}`,
                  name,
                  code: this._generateCode(name)
                });
              }
            }
          });
        }
      }
    } catch (e) {}

    // Ensure 'General' is always available as fallback
    if (!subjectsMap.has('general')) {
      subjectsMap.set('general', { id: 'general', name: 'General', code: 'GEN' });
    }

    return Array.from(subjectsMap.values());
  }

  /**
   * Helper to derive an abbreviated code from a subject name.
   */
  _generateCode(name) {
    if (!name) return 'SUBJ';
    const words = name.trim().split(/\s+/);
    if (words.length > 1) {
      return words.map(w => w[0]).join('').toUpperCase().slice(0, 6);
    }
    return name.slice(0, 4).toUpperCase();
  }

  /**
   * Grounds a single candidate task against available user subjects.
   * Matches by exact name, subject code, or word-boundary tokens in title/description.
   * 
   * @param {Object} rawTask - Extracted task candidate
   * @param {Array} userSubjects - List of user subjects from getUserSubjects()
   * @returns {Object} Grounded task with matching metadata
   */
  groundTask(rawTask, userSubjects = null) {
    const subjects = userSubjects || this.getUserSubjects();
    const candidateSubject = (rawTask.subject || '').trim().toLowerCase();
    const taskTitle = (rawTask.title || rawTask.content || '').trim().toLowerCase();
    const taskDesc = (rawTask.description || '').trim().toLowerCase();

    let bestMatch = null;
    let highestScore = 0;

    for (const subj of subjects) {
      const subjName = subj.name.toLowerCase();
      const subjCode = (subj.code || '').toLowerCase();

      // Skip generic 'general' during specific matching unless nothing else matches
      if (subjName === 'general') continue;

      // Tier 1: Exact match on candidate subject
      if (candidateSubject && candidateSubject === subjName) {
        bestMatch = subj;
        highestScore = 1.0;
        break;
      }

      // Tier 2: Subject code matches candidate subject (e.g. CS101, MATH)
      if (subjCode && candidateSubject && candidateSubject === subjCode) {
        bestMatch = subj;
        highestScore = 0.95;
        break;
      }

      // Tier 3: Candidate subject contains subject name or code
      if (candidateSubject && (candidateSubject.includes(subjName) || subjName.includes(candidateSubject))) {
        if (highestScore < 0.85) {
          bestMatch = subj;
          highestScore = 0.85;
        }
      }

      // Tier 4: Task title contains subject name or subject code as whole word
      const nameRegex = new RegExp(`\\b${this._escapeRegex(subjName)}\\b`, 'i');
      if (nameRegex.test(taskTitle)) {
        if (highestScore < 0.8) {
          bestMatch = subj;
          highestScore = 0.8;
        }
      }

      if (subjCode && subjCode.length >= 3) {
        const codeRegex = new RegExp(`\\b${this._escapeRegex(subjCode)}\\b`, 'i');
        if (codeRegex.test(taskTitle)) {
          if (highestScore < 0.75) {
            bestMatch = subj;
            highestScore = 0.75;
          }
        }
      }

      // Tier 5: Description contains subject name
      if (taskDesc && nameRegex.test(taskDesc)) {
        if (highestScore < 0.6) {
          bestMatch = subj;
          highestScore = 0.6;
        }
      }
    }

    const isGrounded = Boolean(bestMatch && highestScore >= 0.7);
    const resolvedSubject = isGrounded ? bestMatch.name : (candidateSubject ? this._capitalize(rawTask.subject) : 'General');

    return {
      ...rawTask,
      title: rawTask.title || rawTask.content || 'Untitled Task',
      project: resolvedSubject,
      subject: resolvedSubject,
      isGrounded,
      matchScore: highestScore,
      matchedSubjectName: bestMatch ? bestMatch.name : null,
      availableSubjects: subjects.map(s => s.name)
    };
  }

  /**
   * Grounds an array of extracted candidate tasks.
   * @param {Array} tasks - List of candidate tasks
   * @returns {Array} Grounded tasks with validation metadata
   */
  groundAll(tasks) {
    const userSubjects = this.getUserSubjects();
    if (!Array.isArray(tasks)) return [];
    return tasks.map(task => this.groundTask(task, userSubjects));
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _capitalize(str) {
    if (!str) return 'General';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

export const subjectGrounder = new SubjectGrounder();
if (typeof window !== 'undefined') {
  window.SubjectGrounder = SubjectGrounder;
  window.subjectGrounder = subjectGrounder;
}
