# GPA Predictor - Configuration Guide

## Overview

The GPA Predictor is a real-time grade point average calculator integrated into GPAce's Subject Marks page. It allows students to dynamically add/remove subjects, input credits and marks (or select letter grades), and instantly see their calculated Semester GPA.

## Features

- ✅ **Dynamic Subject Management**: Add/remove subjects on the fly
- ✅ **Dual Input Modes**: Enter numerical marks (0-100) OR select letter grades
- ✅ **Multiple Grading Scales**: 4.0 (US), 10.0 (India/Europe), 5.0 scales
- ✅ **Real-time Calculation**: Instant GPA updates with debounced performance
- ✅ **What-If Scenarios**: Predict GPA based on future expected scores
- ✅ **Data Persistence**: Auto-saves to localStorage
- ✅ **Export Functionality**: Download GPA report as text file
- ✅ **Mobile Responsive**: Works on all screen sizes
- ✅ **Accessible**: ARIA labels and keyboard navigation support

---

## How to Modify the Grading Policy

### File Location
`js/gpa-predictor.js`

### Grading Scales Structure

The grading scales are defined in the `GRADING_SCALES` constant at the top of the file:

```javascript
const GRADING_SCALES = {
    '4.0': {
        name: '4.0 Scale (US Standard)',
        maxGPA: 4.0,
        grades: [
            { min: 90, max: 100, grade: 'A+', gp: 4.0 },
            { min: 85, max: 89.99, grade: 'A', gp: 4.0 },
            // ... more grade levels
        ]
    },
    // ... other scales
};
```

### Adding a New Grading Scale

1. Open `js/gpa-predictor.js`
2. Add a new key to the `GRADING_SCALES` object:

```javascript
const GRADING_SCALES = {
    // ... existing scales ...
    
    'YOUR_SCALE_ID': {
        name: 'Your University Name Scale',
        maxGPA: 4.0,  // The maximum possible GPA
        grades: [
            { min: 95, max: 100, grade: 'A+', gp: 4.0 },
            { min: 90, max: 94.99, grade: 'A', gp: 3.9 },
            { min: 85, max: 89.99, grade: 'A-', gp: 3.7 },
            { min: 80, max: 84.99, grade: 'B+', gp: 3.3 },
            { min: 75, max: 79.99, grade: 'B', gp: 3.0 },
            { min: 70, max: 74.99, grade: 'B-', gp: 2.7 },
            { min: 65, max: 69.99, grade: 'C+', gp: 2.3 },
            { min: 60, max: 64.99, grade: 'C', gp: 2.0 },
            { min: 55, max: 59.99, grade: 'C-', gp: 1.7 },
            { min: 50, max: 54.99, grade: 'D', gp: 1.0 },
            { min: 0, max: 49.99, grade: 'F', gp: 0.0 }
        ]
    }
};
```

### Grade Level Properties

Each grade level in the `grades` array must have:

| Property | Type | Description |
|----------|------|-------------|
| `min` | number | Minimum marks percentage (inclusive) |
| `max` | number | Maximum marks percentage (inclusive) |
| `grade` | string | Letter grade label (e.g., 'A+', 'B', 'F') |
| `gp` | number | Grade point value for this grade |

### Important Rules

1. **Grade ranges must be contiguous**: Ensure there are no gaps in the min-max ranges
2. **Order matters**: Grades should be listed from highest to lowest (A+ first, F last)
3. **Use .99 for max values**: To avoid overlap issues (e.g., `max: 89.99`)
4. **maxGPA must match**: The `maxGPA` value should equal the highest `gp` in your grades array

### Modifying an Existing Scale

Find the scale you want to modify and update the values:

```javascript
// Example: Changing the A+ threshold from 90 to 95
{ min: 95, max: 100, grade: 'A+', gp: 4.0 },  // Changed from min: 90
{ min: 90, max: 94.99, grade: 'A', gp: 3.9 }, // Changed from min: 85
// ... adjust other grades accordingly
```

### Changing the Default Scale

To change which scale is selected by default when users first visit:

1. Find the `GPAPredictor` class constructor
2. Change the `this.currentScale` value:

```javascript
class GPAPredictor {
    constructor(containerId = 'gpaPredictorContainer') {
        // ...
        this.currentScale = '4.0';  // Change to your preferred scale ID
        // ...
    }
}
```

---

## Custom Scale via JSON Config (Advanced)

For university-level customization, you can load grading scales from an external JSON file:

### 1. Create a config file: `data/grading-scales.json`

```json
{
    "custom_university": {
        "name": "My University Scale",
        "maxGPA": 4.0,
        "grades": [
            { "min": 93, "max": 100, "grade": "A", "gp": 4.0 },
            { "min": 90, "max": 92.99, "grade": "A-", "gp": 3.7 }
        ]
    }
}
```

### 2. Load in the module:

```javascript
// Add this function to gpa-predictor.js
async function loadCustomScales() {
    try {
        const response = await fetch('./data/grading-scales.json');
        const customScales = await response.json();
        Object.assign(GRADING_SCALES, customScales);
    } catch (e) {
        console.warn('No custom grading scales found');
    }
}

// Call before initialization
await loadCustomScales();
```

---

## GPA Calculation Formula

The GPA is calculated using the standard weighted average formula:

```
GPA = Σ(Credit_i × GradePoint_i) / Σ(Credit_i)
```

Where:
- `Credit_i` = Credit hours for subject i
- `GradePoint_i` = Grade point value for the grade earned in subject i

### Example

| Subject | Credits | Marks | Grade | GP |
|---------|---------|-------|-------|-----|
| Math | 4 | 92 | A+ | 4.0 |
| Physics | 3 | 85 | A | 4.0 |
| English | 3 | 72 | B | 3.0 |

**Calculation:**
```
GPA = (4×4.0 + 3×4.0 + 3×3.0) / (4+3+3)
    = (16 + 12 + 9) / 10
    = 37 / 10
    = 3.70
```

---

## Storage

Data is stored in localStorage with the key `gpaPredictorData_v2`:

```javascript
{
    "subjects": [
        {
            "id": "subj_abc123",
            "name": "Mathematics",
            "credits": 4,
            "marks": 92,
            "selectedGrade": null
        }
    ],
    "currentScale": "4.0",
    "inputMode": "marks",
    "savedAt": "2024-01-15T10:30:00.000Z"
}
```

---

## Troubleshooting

### GPA shows "—" (dash)
- Ensure at least one subject has both credits > 0 AND valid marks/grade
- Check that marks are between 0-100

### Grades not matching expected values
- Verify your grading scale's min/max ranges don't have gaps
- Ensure ranges use `.99` for max values to avoid floating point issues

### Data not persisting
- Check browser's localStorage quota
- Ensure you're not in incognito/private mode
- Try clicking the browser's "Allow storage" if prompted

---

## CSS Customization

The GPA Predictor styles are in `css/gpa-predictor.css`. Key variables to customize:

```css
/* Change GPA classification colors */
.gpa-main-value.excellent { color: #10b981; }  /* Green */
.gpa-main-value.good { color: #3b82f6; }       /* Blue */
.gpa-main-value.average { color: #f59e0b; }    /* Yellow */
.gpa-main-value.poor { color: #ef4444; }       /* Red */
```

---

## API Reference

### Public Methods

```javascript
const predictor = initGPAPredictor('containerId');

// Add a subject programmatically
predictor.addSubject('Math 101', 4, 85);

// Get all subjects
const subjects = predictor.getSubjects();

// Get current GPA
const gpa = predictor.getCurrentGPA();

// Change grading scale
predictor.setScale('10.0');

// Clean up
predictor.destroy();
```

---

## Support

For issues or feature requests, please open an issue on the GPAce repository.
