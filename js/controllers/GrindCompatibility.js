/**
 * GrindCompatibility.js - Compatibility layer for legacy inline scripts
 * 
 * This file provides global function aliases for legacy inline script code
 * in grind.html that hasn't been migrated to controllers yet.
 * 
 * These shims ensure backward compatibility during the migration process.
 */

// Import controllers
import timerController from './TimerController.js';
import taskDisplayController from './TaskDisplayController.js';
import energyController from './EnergyController.js';
import quoteController from './QuoteController.js';

// Timer title functions - legacy compatibility
window.startTimerTitleUpdates = function (timeLeftSeconds, timerType) {
    console.log('[Compat] startTimerTitleUpdates called - delegating to TimerController');
    // TimerController handles this internally
};

window.stopTimerTitleUpdates = function () {
    console.log('[Compat] stopTimerTitleUpdates called - delegating to TimerController');
    // TimerController handles this internally
};

window.updateTimerTitle = function () {
    timerController.updateDisplay();
};

// Task display functions
window.displayPriorityTask = function (force) {
    taskDisplayController.displayPriorityTask(force);
};

window.navigateTask = function (direction) {
    taskDisplayController.navigateTask(direction);
};

window.groupTasksByInterleaveDate = function (tasks) {
    return taskDisplayController.groupTasksByInterleaveDate(tasks);
};

window.hashString = function (str) {
    return taskDisplayController.hashString(str);
};

// Energy functions
window.updateEnergyChart = function () {
    energyController.updateEnergyChart();
};

window.updateEnergyVisualization = function (level, description) {
    energyController.updateEnergyVisualization(level, description);
};

window.showFatigueModal = function () {
    energyController.showFatigueModal();
};

window.hideFatigueModal = function () {
    energyController.hideFatigueModal();
};

// Quote functions
window.rotateQuote = function (direction) {
    quoteController.rotateQuote(direction);
};

// Safe DOM utilities
window.safeAddEventListener = function (selector, event, handler) {
    const el = document.querySelector(selector);
    if (el) {
        el.addEventListener(event, handler);
    } else {
        console.warn(`[SafeDOM] Element not found: ${selector}`);
    }
};

window.safeToggleClass = function (selector, className, condition) {
    const el = document.querySelector(selector);
    if (el?.classList) {
        condition ? el.classList.add(className) : el.classList.remove(className);
        return true;
    }
    return false;
};

console.log('✅ GrindCompatibility layer loaded - legacy functions available');
