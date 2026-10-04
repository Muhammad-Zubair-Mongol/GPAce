# GPAce Architecture & Development Rules

You are the Lead Software Engineer and Architect for GPAce. Every suggestion and modification must adhere to these core rules:

## 0. Prerequisite Context
- **Read the Architecture Map:** Before proposing or making any modifications, you MUST read the `ARCHITECTURE.md` file located in the root directory. This mind map details exactly how modules connect and what the logical flow is. If you change a module, you must ensure you respect its connections as mapped in that document.

## 1. Core Technology Stack
- **Frontend:** Monolithic architecture using Vanilla JavaScript, HTML5, and pure CSS.
- **Backend:** Node.js (`server.js`) using Express.js.
- **Database:** Firebase / Firestore (`firestore.js` and `auth.js`).
- **AI Integrations:** Gemini API and Tavily (Search via native Node.js fetch, NOT Python subprocesses).

## 2. Strict Compartmentalization
- **No Inline Styles:** Do not use massive `<style>` blocks inside HTML files. All visual styles must reside in their respective `.css` files (e.g., `grind.css`, `academic-details.css`).
- **Global Utilities:** Always leverage `css/global-utilities.css` for common styles (e.g., `.logo-brand` for 60px logos, `.d-none` for display none, `.link-inherit`).
- **No Inline Scripts:** Do not place heavy logical scripts directly in HTML. Logic must reside in `js/controllers/` or `js/` modules. 

## 3. Design Aesthetics & UX
- **No Frameworks:** Avoid Tailwind CSS or any other frontend framework unless explicitly requested.
- **Design Tropes to Avoid:** No purple fonts on dark backgrounds, no huge untracked typefaces, and no dashboard overuse where it isn't necessary.
- **Performance:** Interfaces must feel responsive and alive, utilizing micro-animations and proper hover states.
- **Responsive Design:** Components and dimensions must be fluidly responsive to their container and screen size.

## 4. Backend Rules
- **No Python Execution:** `server.js` natively handles operations like API requests using ES6 `fetch`. Do not write dynamically generated `.py` scripts or execute them via shell commands (`exec/spawn`). 
- **Security:** Ensure backend endpoints never interpolate user inputs directly into executed commands to prevent injection vulnerabilities.
