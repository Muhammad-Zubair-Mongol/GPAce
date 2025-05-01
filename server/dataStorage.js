const fs = require('fs').promises;
const path = require('path');

class DataStorage {
    constructor() {
        this.dataPath = path.join(__dirname, '..', 'data');
        // Add memory cache
        this.cache = {
            timetable: null,
            locations: null,
            schedule: null,
            cacheTimestamp: {}
        };
        this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL
        this.init();
    }

    async init() {
        try {
            await fs.mkdir(this.dataPath, { recursive: true });
            
            // Initialize storage files if they don't exist
            const files = {
                'timetable.json': { events: [] },
                'locations.json': { spaces: [] },
                'schedule.json': { tasks: [] }
            };

            for (const [filename, defaultContent] of Object.entries(files)) {
                const filePath = path.join(this.dataPath, filename);
                try {
                    await fs.access(filePath);
                } catch {
                    await fs.writeFile(filePath, JSON.stringify(defaultContent, null, 2));
                }
            }
        } catch (error) {
            console.error('Error initializing data storage:', error);
        }
    }

    // Helper method to check if cache is valid
    _isCacheValid(cacheKey) {
        return this.cache[cacheKey] && 
               this.cache.cacheTimestamp[cacheKey] && 
               (Date.now() - this.cache.cacheTimestamp[cacheKey] < this.CACHE_TTL);
    }

    async saveTimetable(timetableData) {
        try {
            const filePath = path.join(this.dataPath, 'timetable.json');
            await fs.writeFile(filePath, JSON.stringify({ events: timetableData }, null, 2));
            // Update cache
            this.cache.timetable = timetableData;
            this.cache.cacheTimestamp.timetable = Date.now();
            return true;
        } catch (error) {
            console.error('Error saving timetable:', error);
            return false;
        }
    }

    async getTimetable() {
        try {
            // Return cached data if available and valid
            if (this._isCacheValid('timetable')) {
                console.log('Using cached timetable data');
                return this.cache.timetable;
            }

            console.log('Reading timetable from disk');
            const filePath = path.join(this.dataPath, 'timetable.json');
            const data = await fs.readFile(filePath, 'utf8');
            const parsedData = JSON.parse(data).events;
            
            // Update cache
            this.cache.timetable = parsedData;
            this.cache.cacheTimestamp.timetable = Date.now();
            
            return parsedData;
        } catch (error) {
            console.error('Error reading timetable:', error);
            return [];
        }
    }

    async clearTimetable() {
        try {
            const filePath = path.join(this.dataPath, 'timetable.json');
            await fs.writeFile(filePath, JSON.stringify({ events: [] }, null, 2));
            // Clear cache
            this.cache.timetable = [];
            this.cache.cacheTimestamp.timetable = Date.now();
            console.log('Timetable data cleared successfully');
            return true;
        } catch (error) {
            console.error('Error clearing timetable:', error);
            return false;
        }
    }

    async saveLocation(locationData) {
        try {
            // We need to get the latest data first
            const existingData = await this.getLocations();
            existingData.spaces.push(locationData);
            
            const filePath = path.join(this.dataPath, 'locations.json');
            await fs.writeFile(filePath, JSON.stringify({ spaces: existingData.spaces }, null, 2));
            
            // Update cache
            this.cache.locations = existingData;
            this.cache.cacheTimestamp.locations = Date.now();
            
            return true;
        } catch (error) {
            console.error('Error saving location:', error);
            return false;
        }
    }

    async getLocations() {
        try {
            // Return cached data if available and valid
            if (this._isCacheValid('locations')) {
                console.log('Using cached locations data');
                return this.cache.locations;
            }

            console.log('Reading locations from disk');
            const filePath = path.join(this.dataPath, 'locations.json');
            const data = await fs.readFile(filePath, 'utf8');
            const parsedData = JSON.parse(data);
            
            // Update cache
            this.cache.locations = parsedData;
            this.cache.cacheTimestamp.locations = Date.now();
            
            return parsedData;
        } catch (error) {
            console.error('Error reading locations:', error);
            return { spaces: [] };
        }
    }

    async saveSchedule(scheduleData) {
        try {
            const filePath = path.join(this.dataPath, 'schedule.json');
            await fs.writeFile(filePath, JSON.stringify({ tasks: scheduleData }, null, 2));
            
            // Update cache
            this.cache.schedule = scheduleData;
            this.cache.cacheTimestamp.schedule = Date.now();
            
            return true;
        } catch (error) {
            console.error('Error saving schedule:', error);
            return false;
        }
    }

    async getSchedule() {
        try {
            // Return cached data if available and valid
            if (this._isCacheValid('schedule')) {
                console.log('Using cached schedule data');
                return this.cache.schedule;
            }

            console.log('Reading schedule from disk');
            const filePath = path.join(this.dataPath, 'schedule.json');
            const data = await fs.readFile(filePath, 'utf8');
            const parsedData = JSON.parse(data).tasks;
            
            // Update cache
            this.cache.schedule = parsedData;
            this.cache.cacheTimestamp.schedule = Date.now();
            
            return parsedData;
        } catch (error) {
            console.error('Error reading schedule:', error);
            return [];
        }
    }
}

module.exports = new DataStorage();
