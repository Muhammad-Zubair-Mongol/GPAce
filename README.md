# GPAce - Your Academic Assistant

GPAce is a web-based academic assistant tool that helps students manage their academic life, including timetables, tasks, and study spaces.

## System Requirements

- **Node.js**: Version 14.0.0 or higher
- **Web Browser**: Modern web browser with JavaScript enabled (Chrome, Firefox, Edge, or Safari)
- **Storage**: Minimum 500MB free space for application and uploads
- **RAM**: Minimum 2GB (4GB recommended)
- **Internet Connection**: Required for API calls and resource loading

## Installation

1. **Install Node.js**:
   - Download and install Node.js from [nodejs.org](https://nodejs.org/)
   - Verify installation by running:
     ```
     node --version
     npm --version
     ```

2. **Clone/Download the Project**:
   - Place the project files in your desired location

3. **Install Dependencies**:
   - Open a terminal/command prompt in the project directory
   - Run:
     ```
     npm install
     ```

4. **Environment Setup**:
   - Create a `.env` file in the root directory
   - Add the following configuration:
     ```
     GEMINI_API_KEY=your_gemini_api_key_here
     ```
   - Replace `your_gemini_api_key_here` with your actual Gemini API key

## Running the Application

1. **Start the Server**:
   - Double-click the `start-server.bat` file
   OR
   - Run in terminal:
     ```
     npm start
     ```

2. **Access the Application**:
   - Open your web browser
   - Navigate to: `http://localhost:3000`

## Project Structure

```
/
├── server.js          # Main server file
├── index.html         # Main landing page
├── js/               # JavaScript files
├── styles/           # CSS stylesheets
├── server/           # Server-side modules
├── uploads/          # User uploaded files
├── data/             # Data storage
└── models/           # Data models
```

## Features

- Academic timetable management
- Task organization
- Study space finder
- Priority calculator
- Dark/light theme support
- File upload capabilities
- AI-powered analysis using Google's Gemini API

## Dependencies

- express: ^4.18.2
- multer: ^1.4.5-lts.1
- dotenv: ^16.3.1
- @google/generative-ai: ^0.1.3
- gemini-api: ^1.0.0

## Browser Compatibility

The application is compatible with:
- Google Chrome (latest 2 versions)
- Mozilla Firefox (latest 2 versions)
- Microsoft Edge (latest 2 versions)
- Safari (latest 2 versions)

## Troubleshooting

1. **Server Won't Start**:
   - Check if Node.js is properly installed
   - Verify port 3000 is not in use
   - Ensure all dependencies are installed

2. **Upload Issues**:
   - Check if uploads directory exists and has write permissions
   - Verify file size is under 5MB
   - Ensure file type is supported (JPEG, PNG, GIF)

3. **API Issues**:
   - Verify Gemini API key is correctly set in .env file
   - Check internet connection
   - Ensure API quota is not exceeded

## Support

For issues and support, please check the documentation or contact the development team.
