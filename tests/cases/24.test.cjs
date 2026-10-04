/** Step 24: deterministic priority scoring and bounded worker lifecycle. */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const priority = require('../../priority-calculator.js');
const {
  calculatePrioritiesWithWorker,
  runPriorityWorker
} = require('../../js/priority-worker-wrapper.js');

describe('Step 24: Deterministic priority scoring and worker lifecycle', () => {
  it('uses a calendar-day policy across Karachi, negative offsets, and DST', () => {
    const karachiNow = new Date('2026-09-29T18:00:00.000Z');
    assert.equal(
      priority.calculateTimeRemainingPoints('2026-09-29', {
        now: karachiNow,
        timeZone: 'Asia/Karachi'
      }),
      100,
      'a task due on the selected local day receives the finite maximum'
    );
    assert.equal(
      priority.calculateTimeRemainingPoints('2026-09-30', {
        now: karachiNow,
        timeZone: 'Asia/Karachi'
      }),
      10,
      'tomorrow remains one calendar day away in Karachi'
    );

    const negativeOffsetNow = new Date('2026-09-30T02:00:00.000Z');
    assert.equal(
      priority.calculateTimeRemainingPoints('2026-09-29', {
        now: negativeOffsetNow,
        timeZone: 'America/Los_Angeles'
      }),
      100,
      'the same date-only value is interpreted in the selected negative offset'
    );

    const dstNow = new Date('2026-03-08T16:30:00.000Z');
    assert.equal(
      priority.calculateTimeRemainingPoints('2026-03-09', {
        now: dstNow,
        timeZone: 'America/New_York'
      }),
      10,
      'DST does not turn a next-day date-only deadline into a fractional day'
    );
  });

  it('returns finite values for invalid dates, overdue caps, and hostile numerics', () => {
    const now = new Date('2026-09-29T12:00:00.000Z');
    assert.equal(priority.calculateTimeRemainingPoints('not-a-date', { now }), 0);
    const overdue30 = priority.calculateTimeRemainingPoints('2026-08-01', { now });
    const overdue100 = priority.calculateTimeRemainingPoints('2020-01-01', { now });
    assert.ok(Number.isFinite(overdue30));
    assert.equal(overdue30, overdue100, 'overdue score is capped at thirty calendar days');

    const score = priority.calculateTaskScore(
      { dueDate: '2026-09-29', section: 'Assignment' },
      Infinity,
      'not numeric',
      'math',
      {
        now,
        academicPerformance: NaN,
        taskWeightages: { subjectWeightages: {}, projectWeightages: {} }
      }
    );
    assert.ok(Number.isFinite(score));
    assert.ok(score >= 0);
  });

  it('keeps equal-score tasks in deterministic project and task order', () => {
    const result = priority.calculateTaskPrioritiesPure({
      subjects: [
        { tag: 'subject-b', name: 'B', relativeScore: 0, cognitiveDifficulty: 0 },
        { tag: 'subject-a', name: 'A', relativeScore: 0, cognitiveDifficulty: 0 }
      ],
      tasks: {
        'subject-b': [{ id: 'z', section: 'revision', dueDate: '2026-10-01' }],
        'subject-a': [{ id: 'a', section: 'revision', dueDate: '2026-10-01' }]
      },
      academicPerformance: {},
      taskWeightages: { subjectWeightages: {}, projectWeightages: {} },
      now: new Date('2026-09-29T12:00:00.000Z')
    });

    assert.deepEqual(result.map(task => `${task.projectId}:${task.id}`), [
      'subject-a:a',
      'subject-b:z'
    ]);
  });

  it('matches direct and worker scores on the same fixed fixture', async () => {
    const input = {
      subjects: [
        { tag: 'math', name: 'Math', relativeScore: '10', cognitiveDifficulty: '5' }
      ],
      allTasks: {
        math: [
          { id: 'today', section: 'Assignment', dueDate: '2026-09-29' },
          { id: 'tomorrow', section: 'Assignment', dueDate: '2026-09-30' },
          { id: 'invalid', section: 'Assignment', dueDate: 'invalid' }
        ]
      },
      subjectMarks: { math: { _performance: 10 } },
      subjectWeightages: {},
      projectWeightages: {},
      now: new Date('2026-09-29T18:00:00.000Z'),
      timeZone: 'Asia/Karachi'
    };
    const direct = priority.calculateTaskPrioritiesPure({
      subjects: input.subjects,
      tasks: input.allTasks,
      academicPerformance: { math: 10 },
      taskWeightages: {
        subjectWeightages: input.subjectWeightages,
        projectWeightages: input.projectWeightages
      },
      now: input.now,
      timeZone: input.timeZone
    });
    const worker = await calculatePrioritiesWithWorker(input, { timeoutMs: 2000 });
    assert.deepEqual(worker, direct);
  });

  it('rejects silent exit and deadline timeout after terminating the worker', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpace-priority-worker-'));
    try {
      const silentPath = path.join(tempDir, 'silent.cjs');
      fs.writeFileSync(silentPath, "require('worker_threads').parentPort.on('message', () => {});\n");
      await assert.rejects(
        runPriorityWorker({}, { workerPath: silentPath, timeoutMs: 50 }),
        error => error && error.code === 'WORKER_TIMEOUT'
      );

      const exitPath = path.join(tempDir, 'exit.cjs');
      fs.writeFileSync(exitPath, "require('worker_threads').parentPort.on('message', () => process.exit(0));\n");
      await assert.rejects(
        runPriorityWorker({}, { workerPath: exitPath, timeoutMs: 500 }),
        error => error && error.code === 'WORKER_NO_RESULT'
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
