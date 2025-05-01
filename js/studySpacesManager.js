class StudySpacesManager {
    constructor() {
        this.spaces = [];
        this.schedule = {
            wakeTime: null,
            wakeBuffer: 0,
            sleepTime: null,
            sleepBuffer: 0,
            timetableImage: null
        };
        this.userId = 'default'; // Will be updated if user is authenticated
        this.studySpaces = [];
        this.currentImage = null;
        this.syncStatus = {
            lastSynced: null,
            isSyncing: false,
            error: null
        };
        this.init();
        this.initializeEventListeners();
        this.loadStudySpaces();
    }

    async init() {
        this.setupSpaceUploads();
        this.setupTimeInputs();
        this.setupTimetableUpload();
        this.setupSaveButton();
        await this.loadSavedSettings();
    }

    async loadSavedSettings() {
        try {
            // Try to get user ID from Firebase Auth if available
            if (window.auth && window.auth.currentUser) {
                this.userId = window.auth.currentUser.uid;
                console.log('Using authenticated user ID:', this.userId);
            }

            const response = await fetch(`/settings/${this.userId}`);
            const settings = await response.json();

            if (settings.spaces) {
                this.spaces = settings.spaces;
                this.restoreSpaceImages();
            }

            if (settings.schedule) {
                this.schedule = settings.schedule;
                this.restoreScheduleSettings();
            }

            // Update sync status UI
            this.updateSyncStatusUI();
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    restoreSpaceImages() {
        this.spaces.forEach((space, index) => {
            if (space && space.imagePath) {
                const spaceElement = document.getElementById(`space${index + 1}`);
                if (spaceElement) {
                    const uploadArea = spaceElement.querySelector('.upload-area');
                    uploadArea.innerHTML = `
                        <img src="${space.imagePath}" alt="Study space ${index + 1}"
                             style="max-width: 100%; height: 200px; object-fit: cover; border-radius: 8px;">
                        <p class="mt-2">Click to change image</p>
                    `;
                }
            }
        });
    }

    restoreScheduleSettings() {
        const wakeTime = document.getElementById('wakeTime');
        const sleepTime = document.getElementById('sleepTime');
        const wakeBuffer = wakeTime.parentElement.querySelector('select');
        const sleepBuffer = sleepTime.parentElement.querySelector('select');

        if (this.schedule.wakeTime) wakeTime.value = this.schedule.wakeTime;
        if (this.schedule.sleepTime) sleepTime.value = this.schedule.sleepTime;
        if (this.schedule.wakeBuffer) wakeBuffer.value = this.schedule.wakeBuffer;
        if (this.schedule.sleepBuffer) sleepBuffer.value = this.schedule.sleepBuffer;

        if (this.schedule.timetableImage) {
            const uploadArea = document.getElementById('timetableUpload');
            uploadArea.innerHTML = `
                <img src="${this.schedule.timetableImage.path}" alt="Class timetable"
                     style="max-width: 100%; height: 300px; object-fit: contain; border-radius: 8px;">
                <p class="mt-2">Click to change image</p>
            `;
        }
    }

    setupSpaceUploads() {
        document.querySelectorAll('.study-space-upload').forEach((space, index) => {
            const uploadArea = space.querySelector('.upload-area');
            const fileInput = space.querySelector('.file-input');
            const locationInput = space.querySelector('.location-input');
            const amenityInputs = space.querySelectorAll('.amenities input');

            if (!fileInput || !uploadArea) {
                console.error(`Missing elements for space ${index + 1}`);
                return;
            }

            this.setupDragAndDrop(uploadArea, fileInput, index);

            // Handle location input
            if (locationInput) {
                locationInput.addEventListener('input', (e) => {
                    this.spaces[index] = {
                        ...this.spaces[index],
                        location: e.target.value
                    };
                    this.saveSettings();
                });
            }

            // Handle amenity checkboxes
            amenityInputs.forEach(input => {
                input.addEventListener('change', () => {
                    this.spaces[index] = {
                        ...this.spaces[index],
                        amenities: Array.from(amenityInputs)
                            .map(cb => ({ name: cb.nextSibling.textContent.trim(), checked: cb.checked }))
                    };
                    this.saveSettings();
                });
            });
        });
    }

    setupDragAndDrop(uploadArea, fileInput, index) {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', async (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                await this.uploadAndHandleImage(file, uploadArea, index);
            }
        });

        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.uploadAndHandleImage(file, uploadArea, index);
            }
        });
    }

    async uploadAndHandleImage(file, uploadArea, index) {
        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('userId', this.userId);

            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                uploadArea.innerHTML = `
                    <img src="${result.filePath}" alt="Study space ${index + 1}"
                         style="max-width: 100%; height: 200px; object-fit: cover; border-radius: 8px;">
                    <p class="mt-2">Click to change image</p>
                `;

                // Store the full image data
                this.spaces[index] = {
                    ...this.spaces[index],
                    imagePath: result.filePath,
                    fileName: result.fileName,
                    uploadTime: new Date().toISOString()
                };

                // Immediately save settings after successful upload
                await this.saveSettings();

                if (window.soundManager) {
                    window.soundManager.playSound('click', 'confirm');
                }
            }
        } catch (error) {
            console.error('Error uploading image:', error);
            alert('Error uploading image. Please try again.');
        }
    }

    async handleTimetableImage(file) {
        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('userId', this.userId);

            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                const uploadArea = document.getElementById('timetableUpload');
                uploadArea.innerHTML = `
                    <img src="${result.filePath}" alt="Class timetable"
                         style="max-width: 100%; height: 300px; object-fit: contain; border-radius: 8px;">
                    <p class="mt-2">Click to change image</p>
                `;

                // Store the full timetable image data
                this.schedule.timetableImage = {
                    path: result.filePath,
                    fileName: result.fileName,
                    uploadTime: new Date().toISOString()
                };

                // Analyze the timetable
                const analysisResponse = await fetch('/api/analyze-timetable', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ imagePath: result.filePath })
                });

                const analysis = await analysisResponse.json();

                if (!analysis.error) {
                    this.displayTimetableAnalysis(analysis);
                } else {
                    console.error('Analysis error:', analysis.error);
                }

                // Immediately save settings after successful upload
                await this.saveSettings();

                if (window.soundManager) {
                    window.soundManager.playSound('click', 'confirm');
                }
            }
        } catch (error) {
            console.error('Error uploading timetable:', error);
            alert('Error uploading timetable. Please try again.');
        }
    }

    displayTimetableAnalysis(analysis) {
        const analysisDiv = document.getElementById('timetableAnalysis');
        analysisDiv.style.display = 'block';

        // Add fade-in animation
        analysisDiv.classList.add('fade-in');

        // Display schedule
        this.displayScheduleGrid(analysis.schedule);

        // Display free time analysis
        this.displayFreeTimeAnalysis(analysis.dailyAnalysis);

        // Display weekly stats
        this.displayWeeklyStats(analysis.weeklyStats);

        // Display recommendations
        this.displayRecommendations(analysis.recommendations);

        // Initialize and display the visual timeline
        this.initializeTimeline(analysis.schedule);
    }

    displayScheduleGrid(schedule) {
        const scheduleContainer = document.querySelector('.schedule-grid');
        scheduleContainer.innerHTML = '';

        Object.entries(schedule).forEach(([day, slots]) => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-schedule';

            const dayHeader = document.createElement('h6');
            dayHeader.textContent = day.charAt(0).toUpperCase() + day.slice(1);
            dayCard.appendChild(dayHeader);

            const slotsContainer = document.createElement('div');
            slotsContainer.className = 'time-slots';

            slots.forEach(slot => {
                const slotElement = document.createElement('div');
                slotElement.className = `time-slot ${slot.type}`;

                const timeSpan = document.createElement('span');
                timeSpan.className = 'time';
                timeSpan.textContent = `${slot.start} - ${slot.end}`;

                const detailSpan = document.createElement('span');
                detailSpan.className = slot.type === 'class' ? 'subject' : 'free-time';
                detailSpan.textContent = slot.type === 'class'
                    ? slot.subject
                    : `Free Time (${slot.duration}h)`;

                slotElement.appendChild(timeSpan);
                slotElement.appendChild(detailSpan);
                slotsContainer.appendChild(slotElement);
            });

            dayCard.appendChild(slotsContainer);
            scheduleContainer.appendChild(dayCard);
        });
    }

    initializeTimeline(schedule) {
        const timelineContainer = document.getElementById('visualTimeline');
        const currentDaySpan = document.getElementById('currentDay');
        const timelineGrid = document.querySelector('.timeline-grid');

        let currentDayIndex = 0;
        const days = Object.keys(schedule);

        const updateTimeline = (dayIndex) => {
            const day = days[dayIndex];
            currentDaySpan.textContent = day.charAt(0).toUpperCase() + day.slice(1);

            // Clear existing timeline
            timelineGrid.innerHTML = '';

            // Get wake and sleep times
            const wakeTime = this.parseTime(document.getElementById('wakeTime').value);
            const sleepTime = this.parseTime(document.getElementById('sleepTime').value);

            // Create time blocks
            const slots = schedule[day];
            const totalMinutes = (sleepTime - wakeTime) * 60;
            const blocksPerHour = 2; // 30-minute blocks

            for (let i = 0; i < totalMinutes / 30; i++) {
                const block = document.createElement('div');
                block.className = 'time-block';

                const currentTime = new Date(wakeTime);
                currentTime.setMinutes(currentTime.getMinutes() + (i * 30));

                const timeString = currentTime.toTimeString().slice(0, 5);
                block.setAttribute('data-time', timeString);

                // Find if this time block overlaps with any schedule slot
                const overlappingSlot = this.findOverlappingSlot(timeString, slots);
                if (overlappingSlot) {
                    block.classList.add(overlappingSlot.type + '-time');
                    block.title = overlappingSlot.type === 'class'
                        ? `${overlappingSlot.subject}\n${overlappingSlot.start} - ${overlappingSlot.end}`
                        : `Free Time\n${overlappingSlot.start} - ${overlappingSlot.end}`;
                } else {
                    block.classList.add('buffer-time');
                    block.title = 'Buffer Time';
                }

                timelineGrid.appendChild(block);
            }
        };

        // Initialize with first day
        updateTimeline(currentDayIndex);

        // Set up navigation buttons
        document.getElementById('prevDay').addEventListener('click', () => {
            currentDayIndex = (currentDayIndex - 1 + days.length) % days.length;
            updateTimeline(currentDayIndex);
        });

        document.getElementById('nextDay').addEventListener('click', () => {
            currentDayIndex = (currentDayIndex + 1) % days.length;
            updateTimeline(currentDayIndex);
        });

        // Update timeline when wake/sleep times change
        document.getElementById('wakeTime').addEventListener('change', () => {
            updateTimeline(currentDayIndex);
        });

        document.getElementById('sleepTime').addEventListener('change', () => {
            updateTimeline(currentDayIndex);
        });
    }

    parseTime(timeString) {
        const [hours, minutes] = timeString.split(':').map(Number);
        return hours + minutes / 60;
    }

    findOverlappingSlot(timeString, slots) {
        const currentTime = this.parseTime(timeString);
        return slots.find(slot => {
            const startTime = this.parseTime(slot.start);
            const endTime = this.parseTime(slot.end);
            return currentTime >= startTime && currentTime < endTime;
        });
    }

    displayFreeTimeAnalysis(dailyAnalysis) {
        const container = document.querySelector('.free-time-grid');
        container.innerHTML = '';

        Object.entries(dailyAnalysis).forEach(([day, data]) => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-free-time';

            dayCard.innerHTML = `
                <h6>${day.charAt(0).toUpperCase() + day.slice(1)}</h6>
                <div class="stats">
                    <div class="stat">
                        <span class="label">Free Hours:</span>
                        <span class="value">${data.totalFreeHours.toFixed(1)}</span>
                    </div>
                    <div class="stat">
                        <span class="label">Prime Study Slots:</span>
                        <div class="prime-slots">
                            ${data.primeStudySlots.map(slot => `
                                <div class="prime-slot">
                                    ${slot.start} - ${slot.end} (${slot.duration}h)
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;

            container.appendChild(dayCard);
        });
    }

    displayWeeklyStats(stats) {
        const container = document.querySelector('.weekly-stats');
        container.innerHTML = `
            <div class="stat-card">
                <span class="label">Busiest Day</span>
                <span class="value">${stats.busiest_day.charAt(0).toUpperCase() + stats.busiest_day.slice(1)}</span>
            </div>
            <div class="stat-card">
                <span class="label">Most Free Time</span>
                <span class="value">${stats.lightest_day.charAt(0).toUpperCase() + stats.lightest_day.slice(1)}</span>
            </div>
            <div class="stat-card">
                <span class="label">Weekly Class Hours</span>
                <span class="value">${stats.total_class_hours}</span>
            </div>
            <div class="stat-card">
                <span class="label">Weekly Free Hours</span>
                <span class="value">${stats.total_free_hours}</span>
            </div>
            <div class="stat-card best-days">
                <span class="label">Best Study Days</span>
                <div class="value">
                    ${stats.best_study_days.map(day =>
                        `<span class="study-day">${day.charAt(0).toUpperCase() + day.slice(1)}</span>`
                    ).join('')}
                </div>
            </div>
        `;
    }

    displayRecommendations(recommendations) {
        const container = document.querySelector('.recommendations');
        container.innerHTML = `
            <div class="study-tips">
                <h6>Study Tips</h6>
                <ul>
                    ${recommendations.study_tips.map(tip => `<li>${tip}</li>`).join('')}
                </ul>
            </div>
            <div class="break-tips">
                <h6>Break Management</h6>
                <ul>
                    ${recommendations.break_management.map(tip => `<li>${tip}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    setupTimeInputs() {
        // Wake time input
        const wakeTime = document.getElementById('wakeTime');
        const wakeBuffer = wakeTime.parentElement.querySelector('select');

        wakeTime.addEventListener('change', (e) => {
            this.schedule.wakeTime = e.target.value;
        });

        wakeBuffer.addEventListener('change', (e) => {
            this.schedule.wakeBuffer = parseInt(e.target.value);
        });

        // Sleep time input
        const sleepTime = document.getElementById('sleepTime');
        const sleepBuffer = sleepTime.parentElement.querySelector('select');

        sleepTime.addEventListener('change', (e) => {
            this.schedule.sleepTime = e.target.value;
        });

        sleepBuffer.addEventListener('change', (e) => {
            this.schedule.sleepBuffer = parseInt(e.target.value);
        });
    }

    setupTimetableUpload() {
        const timetableUpload = document.getElementById('timetableUpload');
        const fileInput = document.getElementById('timetableInput');

        if (!timetableUpload || !fileInput) {
            console.error('Missing timetable upload elements');
            return;
        }

        // Handle drag and drop
        timetableUpload.addEventListener('dragover', (e) => {
            e.preventDefault();
            timetableUpload.classList.add('dragover');
        });

        timetableUpload.addEventListener('dragleave', () => {
            timetableUpload.classList.remove('dragover');
        });

        timetableUpload.addEventListener('drop', async (e) => {
            e.preventDefault();
            timetableUpload.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                await this.handleTimetableImage(file);
            }
        });

        // Handle click upload
        timetableUpload.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.handleTimetableImage(file);
            }
        });
    }

    setupSaveButton() {
        document.getElementById('saveSettings').addEventListener('click', () => {
            this.saveSettings();
        });
    }

    async saveSettings() {
        try {
            const settings = {
                spaces: this.spaces.map(space => ({
                    ...space,
                    lastSaved: new Date().toISOString()
                })),
                schedule: {
                    ...this.schedule,
                    lastSaved: new Date().toISOString()
                }
            };

            const response = await fetch(`/settings/${this.userId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });

            const result = await response.json();

            if (result.success) {
                if (window.soundManager) {
                    window.soundManager.playSound('transition', 'success');
                }
                console.log('Settings saved successfully:', settings);
            } else {
                throw new Error('Failed to save settings');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            alert('Error saving settings. Please try again.');
class StudySpacesManager {
    constructor() {
        this.spaces = [];
        this.schedule = {
            wakeTime: null,
            wakeBuffer: 0,
            sleepTime: null,
            sleepBuffer: 0,
            timetableImage: null
        };
        this.userId = 'default'; // In a real app, this would be the user's ID
        this.studySpaces = [];
        this.currentImage = null;
        this.init();
        this.initializeEventListeners();
        this.loadStudySpaces();
    }

    async init() {
        this.setupSpaceUploads();
        this.setupTimeInputs();
        this.setupTimetableUpload();
        this.setupSaveButton();
        await this.loadSavedSettings();
    }

    async loadSavedSettings() {
        try {
            const response = await fetch(`/settings/${this.userId}`);
            const settings = await response.json();

            if (settings.spaces) {
                this.spaces = settings.spaces;
                this.restoreSpaceImages();
            }

            if (settings.schedule) {
                this.schedule = settings.schedule;
                this.restoreScheduleSettings();
            }
        } catch (error) {
            console.error('Error loading settings:', error);
        }
    }

    restoreSpaceImages() {
        this.spaces.forEach((space, index) => {
            if (space && space.imagePath) {
                const spaceElement = document.getElementById(`space${index + 1}`);
                if (spaceElement) {
                    const uploadArea = spaceElement.querySelector('.upload-area');
                    uploadArea.innerHTML = `
                        <img src="${space.imagePath}" alt="Study space ${index + 1}"
                             style="max-width: 100%; height: 200px; object-fit: cover; border-radius: 8px;">
                        <p class="mt-2">Click to change image</p>
                    `;
                }
            }
        });
    }

    restoreScheduleSettings() {
        const wakeTime = document.getElementById('wakeTime');
        const sleepTime = document.getElementById('sleepTime');
        const wakeBuffer = wakeTime.parentElement.querySelector('select');
        const sleepBuffer = sleepTime.parentElement.querySelector('select');

        if (this.schedule.wakeTime) wakeTime.value = this.schedule.wakeTime;
        if (this.schedule.sleepTime) sleepTime.value = this.schedule.sleepTime;
        if (this.schedule.wakeBuffer) wakeBuffer.value = this.schedule.wakeBuffer;
        if (this.schedule.sleepBuffer) sleepBuffer.value = this.schedule.sleepBuffer;

        if (this.schedule.timetableImage) {
            const uploadArea = document.getElementById('timetableUpload');
            uploadArea.innerHTML = `
                <img src="${this.schedule.timetableImage.path}" alt="Class timetable"
                     style="max-width: 100%; height: 300px; object-fit: contain; border-radius: 8px;">
                <p class="mt-2">Click to change image</p>
            `;
        }
    }

    setupSpaceUploads() {
        document.querySelectorAll('.study-space-upload').forEach((space, index) => {
            const uploadArea = space.querySelector('.upload-area');
            const fileInput = space.querySelector('.file-input');
            const locationInput = space.querySelector('.location-input');
            const amenityInputs = space.querySelectorAll('.amenities input');

            if (!fileInput || !uploadArea) {
                console.error(`Missing elements for space ${index + 1}`);
                return;
            }

            this.setupDragAndDrop(uploadArea, fileInput, index);

            // Handle location input
            if (locationInput) {
                locationInput.addEventListener('input', (e) => {
                    this.spaces[index] = {
                        ...this.spaces[index],
                        location: e.target.value
                    };
                    this.saveSettings();
                });
            }

            // Handle amenity checkboxes
            amenityInputs.forEach(input => {
                input.addEventListener('change', () => {
                    this.spaces[index] = {
                        ...this.spaces[index],
                        amenities: Array.from(amenityInputs)
                            .map(cb => ({ name: cb.nextSibling.textContent.trim(), checked: cb.checked }))
                    };
                    this.saveSettings();
                });
            });
        });
    }

    setupDragAndDrop(uploadArea, fileInput, index) {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', async (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                await this.uploadAndHandleImage(file, uploadArea, index);
            }
        });

        uploadArea.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.uploadAndHandleImage(file, uploadArea, index);
            }
        });
    }

    async uploadAndHandleImage(file, uploadArea, index) {
        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('userId', this.userId);

            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                uploadArea.innerHTML = `
                    <img src="${result.filePath}" alt="Study space ${index + 1}"
                         style="max-width: 100%; height: 200px; object-fit: cover; border-radius: 8px;">
                    <p class="mt-2">Click to change image</p>
                `;

                // Store the full image data
                this.spaces[index] = {
                    ...this.spaces[index],
                    imagePath: result.filePath,
                    fileName: result.fileName,
                    uploadTime: new Date().toISOString()
                };

                // Immediately save settings after successful upload
                await this.saveSettings();

                if (window.soundManager) {
                    window.soundManager.playSound('click', 'confirm');
                }
            }
        } catch (error) {
            console.error('Error uploading image:', error);
            alert('Error uploading image. Please try again.');
        }
    }

    async handleTimetableImage(file) {
        try {
            const formData = new FormData();
            formData.append('image', file);
            formData.append('userId', this.userId);

            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                const uploadArea = document.getElementById('timetableUpload');
                uploadArea.innerHTML = `
                    <img src="${result.filePath}" alt="Class timetable"
                         style="max-width: 100%; height: 300px; object-fit: contain; border-radius: 8px;">
                    <p class="mt-2">Click to change image</p>
                `;

                // Store the full timetable image data
                this.schedule.timetableImage = {
                    path: result.filePath,
                    fileName: result.fileName,
                    uploadTime: new Date().toISOString()
                };

                // Analyze the timetable
                const analysisResponse = await fetch('/api/analyze-timetable', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ imagePath: result.filePath })
                });

                const analysis = await analysisResponse.json();

                if (!analysis.error) {
                    this.displayTimetableAnalysis(analysis);
                } else {
                    console.error('Analysis error:', analysis.error);
                }

                // Immediately save settings after successful upload
                await this.saveSettings();

                if (window.soundManager) {
                    window.soundManager.playSound('click', 'confirm');
                }
            }
        } catch (error) {
            console.error('Error uploading timetable:', error);
            alert('Error uploading timetable. Please try again.');
        }
    }

    displayTimetableAnalysis(analysis) {
        const analysisDiv = document.getElementById('timetableAnalysis');
        analysisDiv.style.display = 'block';

        // Add fade-in animation
        analysisDiv.classList.add('fade-in');

        // Display schedule
        this.displayScheduleGrid(analysis.schedule);

        // Display free time analysis
        this.displayFreeTimeAnalysis(analysis.dailyAnalysis);

        // Display weekly stats
        this.displayWeeklyStats(analysis.weeklyStats);

        // Display recommendations
        this.displayRecommendations(analysis.recommendations);

        // Initialize and display the visual timeline
        this.initializeTimeline(analysis.schedule);
    }

    displayScheduleGrid(schedule) {
        const scheduleContainer = document.querySelector('.schedule-grid');
        scheduleContainer.innerHTML = '';

        Object.entries(schedule).forEach(([day, slots]) => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-schedule';

            const dayHeader = document.createElement('h6');
            dayHeader.textContent = day.charAt(0).toUpperCase() + day.slice(1);
            dayCard.appendChild(dayHeader);

            const slotsContainer = document.createElement('div');
            slotsContainer.className = 'time-slots';

            slots.forEach(slot => {
                const slotElement = document.createElement('div');
                slotElement.className = `time-slot ${slot.type}`;

                const timeSpan = document.createElement('span');
                timeSpan.className = 'time';
                timeSpan.textContent = `${slot.start} - ${slot.end}`;

                const detailSpan = document.createElement('span');
                detailSpan.className = slot.type === 'class' ? 'subject' : 'free-time';
                detailSpan.textContent = slot.type === 'class'
                    ? slot.subject
                    : `Free Time (${slot.duration}h)`;

                slotElement.appendChild(timeSpan);
                slotElement.appendChild(detailSpan);
                slotsContainer.appendChild(slotElement);
            });

            dayCard.appendChild(slotsContainer);
            scheduleContainer.appendChild(dayCard);
        });
    }

    initializeTimeline(schedule) {
        const timelineContainer = document.getElementById('visualTimeline');
        const currentDaySpan = document.getElementById('currentDay');
        const timelineGrid = document.querySelector('.timeline-grid');

        let currentDayIndex = 0;
        const days = Object.keys(schedule);

        const updateTimeline = (dayIndex) => {
            const day = days[dayIndex];
            currentDaySpan.textContent = day.charAt(0).toUpperCase() + day.slice(1);

            // Clear existing timeline
            timelineGrid.innerHTML = '';

            // Get wake and sleep times
            const wakeTime = this.parseTime(document.getElementById('wakeTime').value);
            const sleepTime = this.parseTime(document.getElementById('sleepTime').value);

            // Create time blocks
            const slots = schedule[day];
            const totalMinutes = (sleepTime - wakeTime) * 60;
            const blocksPerHour = 2; // 30-minute blocks

            for (let i = 0; i < totalMinutes / 30; i++) {
                const block = document.createElement('div');
                block.className = 'time-block';

                const currentTime = new Date(wakeTime);
                currentTime.setMinutes(currentTime.getMinutes() + (i * 30));

                const timeString = currentTime.toTimeString().slice(0, 5);
                block.setAttribute('data-time', timeString);

                // Find if this time block overlaps with any schedule slot
                const overlappingSlot = this.findOverlappingSlot(timeString, slots);
                if (overlappingSlot) {
                    block.classList.add(overlappingSlot.type + '-time');
                    block.title = overlappingSlot.type === 'class'
                        ? `${overlappingSlot.subject}\n${overlappingSlot.start} - ${overlappingSlot.end}`
                        : `Free Time\n${overlappingSlot.start} - ${overlappingSlot.end}`;
                } else {
                    block.classList.add('buffer-time');
                    block.title = 'Buffer Time';
                }

                timelineGrid.appendChild(block);
            }
        };

        // Initialize with first day
        updateTimeline(currentDayIndex);

        // Set up navigation buttons
        document.getElementById('prevDay').addEventListener('click', () => {
            currentDayIndex = (currentDayIndex - 1 + days.length) % days.length;
            updateTimeline(currentDayIndex);
        });

        document.getElementById('nextDay').addEventListener('click', () => {
            currentDayIndex = (currentDayIndex + 1) % days.length;
            updateTimeline(currentDayIndex);
        });

        // Update timeline when wake/sleep times change
        document.getElementById('wakeTime').addEventListener('change', () => {
            updateTimeline(currentDayIndex);
        });

        document.getElementById('sleepTime').addEventListener('change', () => {
            updateTimeline(currentDayIndex);
        });
    }

    parseTime(timeString) {
        const [hours, minutes] = timeString.split(':').map(Number);
        return hours + minutes / 60;
    }

    findOverlappingSlot(timeString, slots) {
        const currentTime = this.parseTime(timeString);
        return slots.find(slot => {
            const startTime = this.parseTime(slot.start);
            const endTime = this.parseTime(slot.end);
            return currentTime >= startTime && currentTime < endTime;
        });
    }

    displayFreeTimeAnalysis(dailyAnalysis) {
        const container = document.querySelector('.free-time-grid');
        container.innerHTML = '';

        Object.entries(dailyAnalysis).forEach(([day, data]) => {
            const dayCard = document.createElement('div');
            dayCard.className = 'day-free-time';

            dayCard.innerHTML = `
                <h6>${day.charAt(0).toUpperCase() + day.slice(1)}</h6>
                <div class="stats">
                    <div class="stat">
                        <span class="label">Free Hours:</span>
                        <span class="value">${data.totalFreeHours.toFixed(1)}</span>
                    </div>
                    <div class="stat">
                        <span class="label">Prime Study Slots:</span>
                        <div class="prime-slots">
                            ${data.primeStudySlots.map(slot => `
                                <div class="prime-slot">
                                    ${slot.start} - ${slot.end} (${slot.duration}h)
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            `;

            container.appendChild(dayCard);
        });
    }

    displayWeeklyStats(stats) {
        const container = document.querySelector('.weekly-stats');
        container.innerHTML = `
            <div class="stat-card">
                <span class="label">Busiest Day</span>
                <span class="value">${stats.busiest_day.charAt(0).toUpperCase() + stats.busiest_day.slice(1)}</span>
            </div>
            <div class="stat-card">
                <span class="label">Most Free Time</span>
                <span class="value">${stats.lightest_day.charAt(0).toUpperCase() + stats.lightest_day.slice(1)}</span>
            </div>
            <div class="stat-card">
                <span class="label">Weekly Class Hours</span>
                <span class="value">${stats.total_class_hours}</span>
            </div>
            <div class="stat-card">
                <span class="label">Weekly Free Hours</span>
                <span class="value">${stats.total_free_hours}</span>
            </div>
            <div class="stat-card best-days">
                <span class="label">Best Study Days</span>
                <div class="value">
                    ${stats.best_study_days.map(day =>
                        `<span class="study-day">${day.charAt(0).toUpperCase() + day.slice(1)}</span>`
                    ).join('')}
                </div>
            </div>
        `;
    }

    displayRecommendations(recommendations) {
        const container = document.querySelector('.recommendations');
        container.innerHTML = `
            <div class="study-tips">
                <h6>Study Tips</h6>
                <ul>
                    ${recommendations.study_tips.map(tip => `<li>${tip}</li>`).join('')}
                </ul>
            </div>
            <div class="break-tips">
                <h6>Break Management</h6>
                <ul>
                    ${recommendations.break_management.map(tip => `<li>${tip}</li>`).join('')}
                </ul>
            </div>
        `;
    }

    setupTimeInputs() {
        // Wake time input
        const wakeTime = document.getElementById('wakeTime');
        const wakeBuffer = wakeTime.parentElement.querySelector('select');

        wakeTime.addEventListener('change', (e) => {
            this.schedule.wakeTime = e.target.value;
        });

        wakeBuffer.addEventListener('change', (e) => {
            this.schedule.wakeBuffer = parseInt(e.target.value);
        });

        // Sleep time input
        const sleepTime = document.getElementById('sleepTime');
        const sleepBuffer = sleepTime.parentElement.querySelector('select');

        sleepTime.addEventListener('change', (e) => {
            this.schedule.sleepTime = e.target.value;
        });

        sleepBuffer.addEventListener('change', (e) => {
            this.schedule.sleepBuffer = parseInt(e.target.value);
        });
    }

    setupTimetableUpload() {
        const timetableUpload = document.getElementById('timetableUpload');
        const fileInput = document.getElementById('timetableInput');

        if (!timetableUpload || !fileInput) {
            console.error('Missing timetable upload elements');
            return;
        }

        // Handle drag and drop
        timetableUpload.addEventListener('dragover', (e) => {
            e.preventDefault();
            timetableUpload.classList.add('dragover');
        });

        timetableUpload.addEventListener('dragleave', () => {
            timetableUpload.classList.remove('dragover');
        });

        timetableUpload.addEventListener('drop', async (e) => {
            e.preventDefault();
            timetableUpload.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                await this.handleTimetableImage(file);
            }
        });

        // Handle click upload
        timetableUpload.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await this.handleTimetableImage(file);
            }
        });
    }

    setupSaveButton() {
        document.getElementById('saveSettings').addEventListener('click', () => {
            this.saveSettings();
        });
    }

    async saveSettings() {
        try {
            const settings = {
                spaces: this.spaces.map(space => ({
                    ...space,
                    lastSaved: new Date().toISOString()
                })),
                schedule: {
                    ...this.schedule,
                    lastSaved: new Date().toISOString()
                }
            };

            const response = await fetch(`/settings/${this.userId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });

            const result = await response.json();

            if (result.success) {
                if (window.soundManager) {
                    window.soundManager.playSound('transition', 'success');
                }
                console.log('Settings saved successfully:', settings);
            } else {
                throw new Error('Failed to save settings');
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            alert('Error saving settings. Please try again.');
        }
    }

    initializeEventListeners() {
        const uploadArea = document.getElementById('studySpaceUpload');
        const spaceImageInput = document.getElementById('spaceImageInput');
        const saveStudySpaceBtn = document.getElementById('saveStudySpace');
        const studySpaceForm = document.querySelector('.study-space-form');

        // Handle drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                this.handleImageUpload(file);
            }
        });

        // Handle click upload
        uploadArea.addEventListener('click', () => {
            spaceImageInput.click();
        });

        spaceImageInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.handleImageUpload(file);
            }
        });

        // Handle form submission
        saveStudySpaceBtn.addEventListener('click', () => {
            this.saveStudySpace();
        });
    }

    async handleImageUpload(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const imageData = e.target.result;
            document.querySelector('.study-space-form').style.display = 'block';
            this.currentImage = imageData;
        };
        reader.readAsDataURL(file);
    }

    async saveStudySpace() {
        const spaceName = document.getElementById('spaceName').value;
        const spaceLocation = document.getElementById('spaceLocation').value;
        const spaceDescription = document.getElementById('spaceDescription').value;
        const amenities = Array.from(document.querySelectorAll('.amenities input:checked')).map(cb => cb.value);

        if (!spaceName || !spaceLocation || !this.currentImage) {
            alert('Please fill in all required fields and upload an image.');
            return;
        }

        const studySpace = {
            id: Date.now(),
            name: spaceName,
            location: spaceLocation,
            description: spaceDescription,
            amenities: amenities,
            image: this.currentImage,
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            userId: this.userId
        };

        // Save to local storage
        this.studySpaces.push(studySpace);
        localStorage.setItem('studySpaces', JSON.stringify(this.studySpaces));

        // Try to save to Firestore if available
        this.syncToFirestore();

        // Reset form
        this.resetForm();

        // Refresh display
        this.displayStudySpaces();

        // Show success message
        this.showToast('Study space saved successfully!', 'success');
    }

    resetForm() {
        document.getElementById('spaceName').value = '';
        document.getElementById('spaceLocation').value = '';
        document.getElementById('spaceDescription').value = '';
        document.querySelectorAll('.amenities input').forEach(cb => cb.checked = false);
        document.querySelector('.study-space-form').style.display = 'none';
        this.currentImage = null;
    }

    async loadStudySpaces() {
        try {
            // First try to load from Firestore if the module is available
            if (typeof window.loadStudySpacesFromFirestore === 'function') {
                this.setSyncStatus(true, null);
                const firestoreSpaces = await window.loadStudySpacesFromFirestore();
                if (firestoreSpaces) {
                    this.studySpaces = firestoreSpaces;
                    this.setSyncStatus(false, null);
                    this.syncStatus.lastSynced = new Date();
                    this.updateSyncStatusUI();
                    this.displayStudySpaces();
                    return;
                }
            }

            // Fallback to localStorage if Firestore fails or isn't available
            const saved = localStorage.getItem('studySpaces');
            this.studySpaces = saved ? JSON.parse(saved) : [];
            this.displayStudySpaces();
        } catch (error) {
            console.error('Error loading study spaces:', error);
            this.setSyncStatus(false, error.message);

            // Final fallback - empty array
            this.studySpaces = [];
            this.displayStudySpaces();
        }
    }

    displayStudySpaces() {
        const container = document.getElementById('studySpacesContainer');
        const noSpacesMessage = document.getElementById('noSpacesMessage');

        // Clear container
        container.innerHTML = '';

        // Show/hide no spaces message
        if (this.studySpaces.length === 0) {
            if (noSpacesMessage) {
                noSpacesMessage.classList.remove('d-none');
                container.appendChild(noSpacesMessage);
            }
            return;
        } else if (noSpacesMessage) {
            noSpacesMessage.classList.add('d-none');
        }

        this.studySpaces.forEach(space => {
            const card = document.createElement('div');
            card.className = 'col-md-6 col-lg-6 mb-4';
            card.innerHTML = `
                <div class="study-space-card">
                    <img src="${space.image}" alt="${space.name}" class="img-fluid mb-3" style="border-radius: 8px; height: 200px; object-fit: cover; width: 100%;">
                    <h4>${space.name}</h4>
                    <p class="location"><i class="bi bi-geo-alt"></i> ${space.location}</p>
                    <p class="description">${space.description}</p>
                    <div class="amenities-tags mb-3">
                        ${space.amenities.map(amenity => `<span class="badge bg-secondary me-1">${amenity}</span>`).join('')}
                    </div>
                    <div class="d-flex justify-content-between align-items-center">
                        <small class="text-muted">Created: ${this.formatDate(space.createdAt)}</small>
                        <button class="delete-btn btn btn-danger btn-sm" data-id="${space.id}">
                            <i class="bi bi-trash"></i> Delete
                        </button>
                    </div>
                </div>
            `;

            // Add event listener to delete button
            const deleteBtn = card.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', () => this.deleteSpace(space.id));

            container.appendChild(card);
        });
    }

    async deleteSpace(id) {
        if (confirm('Are you sure you want to delete this study space?')) {
            // Remove from local array
            this.studySpaces = this.studySpaces.filter(space => space.id !== id);

            // Update localStorage
            localStorage.setItem('studySpaces', JSON.stringify(this.studySpaces));

            // Try to delete from Firestore if available
            if (typeof window.deleteStudySpaceFromFirestore === 'function') {
                try {
                    this.setSyncStatus(true, null);
                    await window.deleteStudySpaceFromFirestore(id);
                    this.setSyncStatus(false, null);
                    this.syncStatus.lastSynced = new Date();
                } catch (error) {
                    console.error('Error deleting from Firestore:', error);
                    this.setSyncStatus(false, error.message);
                }
            }

            // Update UI
            this.displayStudySpaces();
            this.updateSyncStatusUI();
            this.showToast('Study space deleted successfully', 'success');
        }
    }
}

    // Format date for display
    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString();
    }

    // Set sync status and update UI
    setSyncStatus(isSyncing, error) {
        this.syncStatus.isSyncing = isSyncing;
        this.syncStatus.error = error;
        this.updateSyncStatusUI();
    }

    // Update sync status UI
    updateSyncStatusUI() {
        const syncStatusElement = document.getElementById('syncStatus');
        if (!syncStatusElement) return;

        if (this.syncStatus.isSyncing) {
            syncStatusElement.innerHTML = `<span class="badge bg-warning"><i class="bi bi-arrow-repeat"></i> Syncing...</span>`;
            syncStatusElement.classList.remove('d-none');
        } else if (this.syncStatus.error) {
            syncStatusElement.innerHTML = `<span class="badge bg-danger"><i class="bi bi-exclamation-triangle"></i> Sync Error</span>`;
            syncStatusElement.classList.remove('d-none');
        } else if (this.syncStatus.lastSynced) {
            const timeAgo = this.getTimeAgo(this.syncStatus.lastSynced);
            syncStatusElement.innerHTML = `<span class="badge bg-success"><i class="bi bi-cloud-check"></i> Synced ${timeAgo}</span>`;
            syncStatusElement.classList.remove('d-none');
        } else {
            syncStatusElement.classList.add('d-none');
        }
    }

    // Get time ago string
    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - new Date(date)) / 1000);

        if (seconds < 60) return 'just now';

        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;

        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;

        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    // Show toast message
    showToast(message, type = 'success') {
        const toastElement = document.getElementById('syncToast');
        if (!toastElement) return;

        const toastHeader = toastElement.querySelector('.toast-header');
        const toastBody = toastElement.querySelector('.toast-body');

        // Set toast type
        toastHeader.className = 'toast-header';
        toastHeader.classList.add(`bg-${type}`);
        toastHeader.classList.add('text-white');

        // Set icon based on type
        const iconElement = toastHeader.querySelector('i');
        iconElement.className = 'bi me-2';

        switch (type) {
            case 'success':
                iconElement.classList.add('bi-check-circle');
                break;
            case 'warning':
                iconElement.classList.add('bi-exclamation-triangle');
                break;
            case 'danger':
                iconElement.classList.add('bi-x-circle');
                break;
            default:
                iconElement.classList.add('bi-info-circle');
        }

        // Set message
        toastBody.textContent = message;

        // Show toast
        const toast = new bootstrap.Toast(toastElement);
        toast.show();
    }

    // Sync to Firestore
    async syncToFirestore() {
        if (typeof window.saveStudySpacesToFirestore !== 'function') {
            console.warn('Firestore integration not available');
            return false;
        }

        try {
            this.setSyncStatus(true, null);
            const success = await window.saveStudySpacesToFirestore(this.studySpaces);

            if (success) {
                this.syncStatus.lastSynced = new Date();
                this.setSyncStatus(false, null);
                return true;
            } else {
                this.setSyncStatus(false, 'Failed to sync with Firestore');
                return false;
            }
        } catch (error) {
            console.error('Error syncing to Firestore:', error);
            this.setSyncStatus(false, error.message);
            return false;
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const studySpacesManager = new StudySpacesManager();

    // Add event listener for sync now button
    const syncNowBtn = document.getElementById('syncNowBtn');
    if (syncNowBtn) {
        syncNowBtn.addEventListener('click', async () => {
            const success = await studySpacesManager.syncToFirestore();
            if (success) {
                studySpacesManager.showToast('Study spaces synced successfully!', 'success');
            } else {
                studySpacesManager.showToast('Failed to sync study spaces. Please try again.', 'danger');
            }
        });
    }

    // Add event listener for cancel button
    const cancelBtn = document.getElementById('cancelStudySpace');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            studySpacesManager.resetForm();
        });
    }
});
