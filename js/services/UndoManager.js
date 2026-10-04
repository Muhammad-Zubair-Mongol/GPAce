/**
 * UndoManager.js
 * Implements Command Pattern for undo/redo functionality
 */

class UndoManager {
    constructor() {
        if (UndoManager.instance) return UndoManager.instance;
        UndoManager.instance = this;

        this.undoStack = [];
        this.redoStack = [];
        this.maxStackSize = 50;
    }

    /**
     * Execute a command and push to undo stack
     * @param {Object} command - { execute: () => Promise<void>, undo: () => Promise<void>, label: string }
     */
    async execute(command) {
        try {
            await command.execute();
            this.undoStack.push(command);
            this.redoStack = []; // Clear redo stack on new action

            if (this.undoStack.length > this.maxStackSize) {
                this.undoStack.shift();
            }

            this._notifyStateChange();
        } catch (error) {
            console.error('[UndoManager] Error executing command:', error);
            throw error;
        }
    }

    /**
     * Undo the last command
     */
    async undo() {
        if (this.undoStack.length === 0) return;

        const command = this.undoStack.pop();
        try {
            await command.undo();
            this.redoStack.push(command);
            this._notifyStateChange();
            return command.label;
        } catch (error) {
            console.error('[UndoManager] Error undoing command:', error);
            // Push back if failed?
            this.undoStack.push(command);
            throw error;
        }
    }

    /**
     * Redo the last undone command
     */
    async redo() {
        if (this.redoStack.length === 0) return;

        const command = this.redoStack.pop();
        try {
            // We assume execute is idempotent-ish or re-doable
            await command.execute();
            this.undoStack.push(command);
            this._notifyStateChange();
            return command.label;
        } catch (error) {
            console.error('[UndoManager] Error redoing command:', error);
            this.redoStack.push(command);
            throw error;
        }
    }

    _notifyStateChange() {
        window.dispatchEvent(new CustomEvent('undoStateChanged', {
            detail: {
                canUndo: this.undoStack.length > 0,
                canRedo: this.redoStack.length > 0
            }
        }));
    }
}

const undoManager = new UndoManager();
export default undoManager;
window.UndoManager = undoManager;
