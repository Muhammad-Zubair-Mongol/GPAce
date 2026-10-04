/**
 * StatsController.js - Manages study stats, focus score, and time utilization
 */

class StatsController {
    constructor() {
        this.stats = {
            totalWorkTime: 0,
            focusScore: 0,
            lastSessionDate: null,
            sessionHistory: [],
            activeTimerStart: null,
            pausedTime: 0
        };

        this.updateStatsDisplay = this.updateStatsDisplay.bind(this);
    }

    init() {
        this.loadStats();

        // Expose global functions expected by UI and other controllers
        window.stats = this.stats;
        window.saveStats = this.saveStats.bind(this);
        window.loadStats = this.loadStats.bind(this);
        window.updateStatsDisplay = this.updateStatsDisplay;
        window.calculateTimeUtilization = this.calculateTimeUtilization.bind(this);

        // Initial update
        this.updateStatsDisplay();

        console.log('StatsController initialized');
        return this;
    }

    formatTimeHHMMSS(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainingSeconds = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }

    saveStats() {
        const statsToSave = { ...this.stats };
        delete statsToSave.activeTimerStart;
        delete statsToSave.pausedTime;
        localStorage.setItem('pomodoroStats', JSON.stringify(statsToSave));
    }

    loadStats() {
        const savedStats = JSON.parse(localStorage.getItem('pomodoroStats')) || {};
        this.stats.totalWorkTime = savedStats.totalWorkTime || 0;
        this.stats.focusScore = savedStats.focusScore || 0;
        this.stats.lastSessionDate = savedStats.lastSessionDate || null;
        this.stats.sessionHistory = savedStats.sessionHistory || [];
        this.stats.pausedTime = 0;
        this.stats.activeTimerStart = null;

        // Keep window.stats in sync for legacy checks
        if (window.stats) {
            Object.assign(window.stats, this.stats);
        }

        this.updateStatsDisplay();
    }

    calculateTimeUntilSleep() {
        const sleepTime = localStorage.getItem('sleepTime');
        if (!sleepTime) return null;

        const now = new Date();
        const [sleepHours, sleepMinutes] = sleepTime.split(':').map(Number);
        const sleepDate = new Date(now);
        sleepDate.setHours(sleepHours, sleepMinutes, 0, 0);

        if (sleepDate < now) {
            sleepDate.setDate(sleepDate.getDate() + 1);
        }
        return Math.max(0, Math.floor((sleepDate - now) / 1000));
    }

    calculateTimeUtilization() {
        const wakeTime = localStorage.getItem('wakeTime');
        const sleepTime = localStorage.getItem('sleepTime');

        if (!wakeTime || !sleepTime) return 0;

        const now = new Date();
        const [wakeHours, wakeMinutes] = wakeTime.split(':').map(Number);
        const [sleepHours, sleepMinutes] = sleepTime.split(':').map(Number);

        const wakeDate = new Date(now);
        wakeDate.setHours(wakeHours, wakeMinutes, 0, 0);

        const sleepDate = new Date(now);
        sleepDate.setHours(sleepHours, sleepMinutes, 0, 0);

        if (sleepDate < wakeDate) {
            sleepDate.setDate(sleepDate.getDate() + 1);
        }

        const totalAvailableSeconds = Math.floor((sleepDate - wakeDate) / 1000);
        if (totalAvailableSeconds <= 0) return 0; // Avoid division by zero

        const utilization = (this.stats.totalWorkTime / totalAvailableSeconds) * 100;
        return Math.min(100, Math.max(0, Math.round(utilization)));
    }

    // Placeholder for focus score if not defined globally
    calculateFocusScore() {
        // If there's a global function, use it
        if (typeof window.calculateFocusScore === 'function' && window.calculateFocusScore !== this.calculateFocusScore) {
            return window.calculateFocusScore();
        }
        // Fallback logic
        return this.stats.focusScore || 0;
    }

    updateStatsDisplay() {
        const workTimeEl = document.getElementById('totalWorkTime');
        const streakEl = document.getElementById('currentStreak');
        const focusScoreEl = document.getElementById('focusScore');
        const utilizationEl = document.getElementById('timeUtilization');

        if (workTimeEl) workTimeEl.textContent = this.formatTimeHHMMSS(this.stats.totalWorkTime);
        if (streakEl) streakEl.textContent = this.stats.currentStreak || 0;

        if (focusScoreEl) {
            const score = this.calculateFocusScore();
            focusScoreEl.textContent = `${score}%`;
        }

        if (utilizationEl) {
            const util = this.calculateTimeUtilization();
            utilizationEl.textContent = `${util}%`;
        }
    }
}

const statsController = new StatsController();
export default statsController;

if (typeof window !== 'undefined') {
    window.statsController = statsController;
}
