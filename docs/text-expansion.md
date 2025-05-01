# Text Expansion Feature for GPAce

## Overview

The Text Expansion feature allows you to create and use text shortcuts in the AI search container. Similar to the Text Blaze extension, this feature lets you define shortcuts that expand into longer text when typed in the search bar.

## How to Use

### Creating Snippets

1. Click the lightning bolt icon (⚡) in the search bar or press `Alt+S` to open the Snippet Manager.
2. In the Snippet Manager, enter:
   - **Shortcut**: The text you want to type to trigger the expansion (without the trigger character)
   - **Expanded Text**: The full text that will replace your shortcut
   - **Description**: (Optional) A description to help you remember what the snippet does
3. Click "Save Snippet" to save your new snippet.

### Using Snippets

1. In the search bar, type the trigger character (`/`) followed by your shortcut.
2. The shortcut will automatically expand when:
   - You type a space after the shortcut
   - You press Enter after the shortcut
   - You complete typing the exact shortcut

### Example

If you create a snippet with:
- Shortcut: `hello`
- Expanded Text: `Hello, how can you help me with my homework today?`

Then typing `/hello` in the search bar and pressing space or Enter will replace it with the full expanded text.

## Keyboard Shortcuts

- `Alt+S`: Open the Snippet Manager
- `/`: Trigger character for snippets (type this before your shortcut)
- `Ctrl+Enter`: Save a snippet when editing in the Snippet Manager

## Managing Snippets

In the Snippet Manager, you can:
- Create new snippets
- Edit existing snippets by clicking the "Edit" button
- Delete snippets by clicking the "Delete" button
- Reset to default snippets by clicking the "Reset to Defaults" button

## Technical Details

- Snippets are stored in both your browser's localStorage and in Firestore (when signed in)
- Snippets are synchronized across devices when you're signed in
- Smart versioning ensures you always have the latest snippets
- Real-time updates keep your snippets in sync across multiple open tabs
- Snippets persist between sessions and across devices

## Tips

- Create snippets for frequently used search queries
- Use short, memorable shortcuts for efficiency
- Consider using a naming convention for your shortcuts (e.g., `/q` for questions, `/d` for definitions)
- You can include complex formatting in your expanded text
- Create snippets that end with a space or colon to position the cursor perfectly for continued typing
- For research papers, create snippets for different sections (introduction, methodology, results, etc.)
- Use snippets for complex formulas or equations you frequently search for
- Create snippets for different subjects or courses to quickly switch contexts
