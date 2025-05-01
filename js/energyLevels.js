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
        const stored = localStorage.getItem('energyLevels');
        return stored ? JSON.parse(stored) : [];
    }

    saveEnergyLevels() {
        localStorage.setItem('energyLevels', JSON.stringify(this.energyLevels));
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
