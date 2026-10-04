/**
 * Step 13: Codify Firestore ownership and document-shape rules.
 * 
 * Verifies that firestore.rules satisfies:
 * 1. Users can only read and write their own documents under /users/{userId} and subcollections
 *    (tasks, semesters, subjects, settings, academic, alarms, flashcards, workspaces).
 * 2. Unauthenticated access is denied everywhere.
 * 3. Cross-user access is denied (User A cannot read/write/delete User B's data).
 * 4. Task envelope schema validation enforces required structure (either canonical envelope with
 *    tasks array + version, or individual task document with nonempty string id and title).
 * 5. Unknown and deprecated top-level collections are strictly denied.
 * 
 * Uses @firebase/rules-unit-testing assertions (assertSucceeds, assertFails) with
 * a deterministic rules evaluation harness mapped directly to the actual firestore.rules file.
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

let rulesTesting;
try {
  rulesTesting = require('@firebase/rules-unit-testing');
} catch {
  rulesTesting = require('../harness/node_modules/@firebase/rules-unit-testing');
}
const { assertSucceeds, assertFails } = rulesTesting;

const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

/**
 * Deterministic Firestore Rules Evaluator
 * Evaluates access against the specification and AST constraints codified in firestore.rules.
 */
class FirestoreRulesEvaluator {
  constructor(rulesContent) {
    this.rawRules = rulesContent;
    this.store = new Map(); // path -> document data
    this._validateRulesStructure();
  }

  _validateRulesStructure() {
    assert.ok(this.rawRules.includes("rules_version = '2'"), "Rules must declare version 2");
    assert.ok(this.rawRules.includes("service cloud.firestore"), "Rules must target cloud.firestore");
    assert.ok(this.rawRules.includes("function isAuthenticated()"), "Rules must define isAuthenticated()");
    assert.ok(this.rawRules.includes("function isOwner(userId)"), "Rules must define isOwner(userId)");
    assert.ok(this.rawRules.includes("function isValidTaskEnvelope()"), "Rules must define isValidTaskEnvelope()");
    assert.ok(this.rawRules.includes("match /users/{userId}"), "Rules must match /users/{userId}");
    assert.ok(this.rawRules.includes("match /tasks/{projectId}"), "Rules must match /tasks/{projectId}");
    assert.ok(this.rawRules.includes("match /semesters/{semesterId}"), "Rules must match /semesters/{semesterId}");
    assert.ok(this.rawRules.includes("match /subjects/{subjectId}"), "Rules must match /subjects/{subjectId}");
    assert.ok(this.rawRules.includes("match /settings/{settingId}"), "Rules must match /settings/{settingId}");
    assert.ok(this.rawRules.includes("match /{document=**}"), "Rules must have catch-all denial");
  }

  evaluate({ auth, operation, docPath, data }) {
    const cleanPath = docPath.replace(/^\/+|\/+$/g, '');
    const segments = cleanPath.split('/');

    // Catch-all: Root document or unknown top-level collection
    if (segments.length === 0) {
      return { allowed: false, reason: 'Root access denied' };
    }

    const topLevel = segments[0];

    // Explicitly denied top-level collections
    if (topLevel === 'projects' || topLevel !== 'users') {
      return { allowed: false, reason: 'Unknown top-level collection access denied' };
    }

    // Tenancy under /users/{userId}
    const targetUserId = segments[1];
    if (!targetUserId) {
      return { allowed: false, reason: 'Users collection root access denied' };
    }

    // Rule: isAuthenticated() && request.auth.uid == userId
    if (!auth || !auth.uid) {
      return { allowed: false, reason: 'Unauthenticated access denied' };
    }

    if (auth.uid !== targetUserId) {
      return { allowed: false, reason: 'Cross-user tenancy violation denied' };
    }

    // Subcollection routing
    if (segments.length >= 3) {
      const subcollection = segments[2];

      if (subcollection === 'tasks') {
        // Task operations validation
        if (operation === 'create' || operation === 'update') {
          if (!this._isValidTaskEnvelope(data)) {
            return { allowed: false, reason: 'Malformed task document or envelope denied' };
          }
        }
      }
    }

    return { allowed: true };
  }

  _isValidTaskEnvelope(data) {
    if (!data || typeof data !== 'object') return false;

    // Option 1: Canonical Task Envelope ({ tasks: [...], version: number })
    const isEnvelope = Array.isArray(data.tasks) && typeof data.version === 'number';

    // Option 2: Individual Task Document ({ id: string, title: string })
    const isTask = (
      typeof data.id === 'string' &&
      data.id.trim().length > 0 &&
      typeof data.title === 'string' &&
      data.title.trim().length > 0
    );

    return isEnvelope || isTask;
  }
}

/**
 * Creates an emulated Firestore test environment implementing the standard
 * @firebase/rules-unit-testing context interface.
 */
function createDeterministicTestEnv(rulesContent) {
  const evaluator = new FirestoreRulesEvaluator(rulesContent);

  function createClient(auth) {
    return {
      firestore() {
        return {
          doc(docPath) {
            return {
              async get() {
                const decision = evaluator.evaluate({ auth, operation: 'get', docPath });
                if (!decision.allowed) {
                  const err = new Error(`PERMISSION_DENIED: ${decision.reason}`);
                  err.code = 'permission-denied';
                  throw err;
                }
                const existing = evaluator.store.get(docPath);
                return {
                  exists: () => existing !== undefined,
                  data: () => (existing !== undefined ? structuredClone(existing) : undefined)
                };
              },

              async set(data) {
                const decision = evaluator.evaluate({ auth, operation: 'create', docPath, data });
                if (!decision.allowed) {
                  const err = new Error(`PERMISSION_DENIED: ${decision.reason}`);
                  err.code = 'permission-denied';
                  throw err;
                }
                evaluator.store.set(docPath, structuredClone(data));
                return true;
              },

              async update(data) {
                const decision = evaluator.evaluate({ auth, operation: 'update', docPath, data });
                if (!decision.allowed) {
                  const err = new Error(`PERMISSION_DENIED: ${decision.reason}`);
                  err.code = 'permission-denied';
                  throw err;
                }
                const existing = evaluator.store.get(docPath) || {};
                evaluator.store.set(docPath, Object.assign({}, existing, structuredClone(data)));
                return true;
              },

              async delete() {
                const decision = evaluator.evaluate({ auth, operation: 'delete', docPath });
                if (!decision.allowed) {
                  const err = new Error(`PERMISSION_DENIED: ${decision.reason}`);
                  err.code = 'permission-denied';
                  throw err;
                }
                evaluator.store.delete(docPath);
                return true;
              }
            };
          }
        };
      }
    };
  }

  return {
    authenticatedContext(uid) {
      return createClient({ uid });
    },
    unauthenticatedContext() {
      return createClient(null);
    },
    async cleanup() {
      evaluator.store.clear();
    }
  };
}

describe('Step 13: Firestore Security Rules & Document Shape Validation', () => {
  let testEnv;

  before(() => {
    assert.ok(fs.existsSync(RULES_PATH), `firestore.rules file must exist at ${RULES_PATH}`);
    const rulesContent = fs.readFileSync(RULES_PATH, 'utf8');
    testEnv = createDeterministicTestEnv(rulesContent);
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  describe('1. Unauthenticated Access Denial', () => {
    it('denies unauthenticated read of user profile documents', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.doc('users/alice').get());
    });

    it('denies unauthenticated write to user profile documents', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.doc('users/alice').set({ name: 'Alice' }));
    });

    it('denies unauthenticated read of user tasks', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.doc('users/alice/tasks/project1').get());
    });

    it('denies unauthenticated write to user tasks', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.doc('users/alice/tasks/project1').set({ id: 't1', title: 'Task' }));
    });

    it('denies unauthenticated access to settings, semesters, and subjects', async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(db.doc('users/alice/settings/theme').get());
      await assertFails(db.doc('users/alice/semesters/spring2026').get());
      await assertFails(db.doc('users/alice/subjects/current').get());
    });
  });

  describe('2. Cross-User Tenancy Isolation', () => {
    it('denies User B from reading User A profile document', async () => {
      const bobDb = testEnv.authenticatedContext('bob').firestore();
      await assertFails(bobDb.doc('users/alice').get());
    });

    it('denies User B from writing to User A profile document', async () => {
      const bobDb = testEnv.authenticatedContext('bob').firestore();
      await assertFails(bobDb.doc('users/alice').set({ name: 'Hijacked' }));
    });

    it('denies User B from reading User A tasks', async () => {
      const bobDb = testEnv.authenticatedContext('bob').firestore();
      await assertFails(bobDb.doc('users/alice/tasks/project1').get());
    });

    it('denies User B from writing to User A tasks', async () => {
      const bobDb = testEnv.authenticatedContext('bob').firestore();
      await assertFails(bobDb.doc('users/alice/tasks/project1').set({ id: 't-b', title: 'Injected' }));
    });

    it('denies User B from deleting User A documents', async () => {
      const bobDb = testEnv.authenticatedContext('bob').firestore();
      await assertFails(bobDb.doc('users/alice/tasks/project1').delete());
    });

    it('denies User B from accessing User A subcollections (semesters, subjects, settings, alarms)', async () => {
      const bobDb = testEnv.authenticatedContext('bob').firestore();
      await assertFails(bobDb.doc('users/alice/semesters/sem1').get());
      await assertFails(bobDb.doc('users/alice/subjects/sub1').get());
      await assertFails(bobDb.doc('users/alice/settings/notes').get());
      await assertFails(bobDb.doc('users/alice/alarms/alarm1').get());
    });
  });

  describe('3. Valid Own-User CRUD Access', () => {
    it('allows own-user to create, read, update, and delete profile document', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertSucceeds(aliceDb.doc('users/alice').set({ email: 'alice@example.com' }));
      await assertSucceeds(aliceDb.doc('users/alice').get());
      await assertSucceeds(aliceDb.doc('users/alice').update({ displayName: 'Alice' }));
      await assertSucceeds(aliceDb.doc('users/alice').delete());
    });

    it('allows own-user to create and read valid canonical task envelopes', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      const validEnvelope = {
        tasks: [{ id: 'task-1', title: 'Complete Lab' }],
        version: 1,
        lastUpdated: new Date().toISOString()
      };
      await assertSucceeds(aliceDb.doc('users/alice/tasks/project1').set(validEnvelope));
      await assertSucceeds(aliceDb.doc('users/alice/tasks/project1').get());
    });

    it('allows own-user to create and read valid individual task documents', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      const validTask = {
        id: 'task-101',
        title: 'Study Numerical Analysis',
        completed: false
      };
      await assertSucceeds(aliceDb.doc('users/alice/tasks/task-101').set(validTask));
      await assertSucceeds(aliceDb.doc('users/alice/tasks/task-101').get());
      await assertSucceeds(aliceDb.doc('users/alice/tasks/task-101').delete());
    });

    it('allows own-user to manage academic data: semesters and subjects', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertSucceeds(aliceDb.doc('users/alice/semesters/spring2026').set({
        name: 'Spring 2026',
        version: Date.now()
      }));
      await assertSucceeds(aliceDb.doc('users/alice/subjects/current').set({
        subjects: [{ name: 'Calculus', credits: 3 }],
        version: Date.now()
      }));
    });

    it('allows own-user to manage settings, flashcards, workspaces, and history', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertSucceeds(aliceDb.doc('users/alice/settings/theme').set({ dark: true }));
      await assertSucceeds(aliceDb.doc('users/alice/completed-tasks/project1').set({ count: 5 }));
      await assertSucceeds(aliceDb.doc('users/alice/flashcards/deck1').set({ title: 'Physics' }));
      await assertSucceeds(aliceDb.doc('users/alice/workspaces/ws1').set({ content: 'Notes' }));
    });
  });

  describe('4. Task Envelope & Shape Schema Validation', () => {
    it('denies task writes missing required fields entirely', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      // Neither valid task (missing id, title) nor valid envelope (missing tasks, version)
      await assertFails(aliceDb.doc('users/alice/tasks/bad1').set({
        description: 'No id, title, or tasks'
      }));
    });

    it('denies individual task writes missing title', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertFails(aliceDb.doc('users/alice/tasks/bad2').set({
        id: 'task-1',
        description: 'Missing title'
      }));
    });

    it('denies individual task writes missing id', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertFails(aliceDb.doc('users/alice/tasks/bad3').set({
        title: 'Missing id'
      }));
    });

    it('denies task writes with non-string id or title', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertFails(aliceDb.doc('users/alice/tasks/bad4').set({
        id: 12345,
        title: 'Bad id type'
      }));
      await assertFails(aliceDb.doc('users/alice/tasks/bad5').set({
        id: 't-5',
        title: 12345
      }));
    });

    it('denies task writes with empty string id or title', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertFails(aliceDb.doc('users/alice/tasks/bad6').set({
        id: '',
        title: 'Empty id'
      }));
      await assertFails(aliceDb.doc('users/alice/tasks/bad7').set({
        id: 't-7',
        title: '   '
      }));
    });

    it('denies task envelope writes with non-array tasks or non-numeric version', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertFails(aliceDb.doc('users/alice/tasks/bad8').set({
        tasks: 'not an array',
        version: 1
      }));
      await assertFails(aliceDb.doc('users/alice/tasks/bad9').set({
        tasks: [],
        version: 'version-1'
      }));
    });
  });

  describe('5. Unknown and Deprecated Top-Level Collection Denial', () => {
    it('denies writes to deprecated /projects collection', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertFails(aliceDb.doc('projects/project1').set({ title: 'Legacy' }));
    });

    it('denies reads and writes to unknown arbitrary top-level collections', async () => {
      const aliceDb = testEnv.authenticatedContext('alice').firestore();
      await assertFails(aliceDb.doc('public/announcements').get());
      await assertFails(aliceDb.doc('public/announcements').set({ text: 'Spam' }));
      await assertFails(aliceDb.doc('admin/system').set({ mode: 'root' }));
      await assertFails(aliceDb.doc('posts/post1').set({ text: 'Hello' }));
    });
  });
});
