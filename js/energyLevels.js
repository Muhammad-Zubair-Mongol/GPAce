// Storage helper with fallback (use existing or create new)
if (typeof window.getStorage === 'undefined') {
    window.getStorage = () => window.StorageService || {
        get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
        set: (k, v) => localStorage.setItem(k, JSON.stringify(v))
    };
}
// Use window.getStorage() directly to avoid redeclaration errors

class EnergyTracker {
    constructor() {
        this.energyLevels = this.loadEnergyLevels();
        console.log('Loaded energy levels:', this.energyLevels);
    }

    addEnergyLevel(level, description) {
        const timestamp = new Date().toISOString();
        const entry = {
            timestamp: timestamp,
            level: level,
            description: description
        };

        this.energyLevels.push(entry);
        this.saveEnergyLevels();
        console.log('Added energy level:', entry);
        console.log('Current energy levels:', this.energyLevels);
        return entry;
    }

    loadEnergyLevels() {
        const storage = window.getStorage();
        return storage.get('energyLevels', []);
    }

    saveEnergyLevels() {
        const storage = window.getStorage();
        storage.set('energyLevels', this.energyLevels);
    }

    getEnergyLevels() {
        return this.energyLevels;
    }

    getTodayEnergyLevels() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        return this.energyLevels.filter(entry => {
            const entryDate = new Date(entry.timestamp);
            entryDate.setHours(0, 0, 0, 0);
            return entryDate.getTime() === today.getTime();
        }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    clearEnergyLevels() {
        this.energyLevels = [];
        this.saveEnergyLevels();
        console.log('Cleared energy levels');
    }
}

// Initialize the energy tracker
const energyTracker = new EnergyTracker();
if (typeof window !== 'undefined') {
    window.EnergyTracker = EnergyTracker;
    window.energyTracker = energyTracker;
}
