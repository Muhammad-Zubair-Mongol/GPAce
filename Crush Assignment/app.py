import os
import subprocess
import tempfile
from flask import Flask, request, send_file, render_template_string, flash, redirect, url_for

# --- Configuration ---
PANDOC_PATH = 'pandoc' # Adjust if needed
UPLOAD_FOLDER = tempfile.gettempdir()

# --- Flask App Setup ---
app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.secret_key = os.urandom(24) # Needed for flash messages

# --- Helper Function ---
def check_pandoc():
    """Checks if Pandoc is installed and executable."""
    try:
        # Use --version which is standard and less resource intensive
        subprocess.run([PANDOC_PATH, '--version'], check=True, capture_output=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

# --- HTML Template (Remains the same, only showing relevant part for brevity) ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Markdown to DOCX Converter</title>
    <style>
        body { font-family: sans-serif; line-height: 1.6; padding: 20px; max-width: 800px; margin: auto; background-color: #f4f4f4; }
        .container { background-color: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
        h1 { color: #333; text-align: center; border-bottom: 2px solid #eee; padding-bottom: 10px; margin-bottom: 20px; }
        textarea { width: 98%; min-height: 300px; margin-bottom: 20px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-family: monospace; font-size: 14px; }
        label { display: block; margin-bottom: 8px; font-weight: bold; color: #555; }
        .btn { display: inline-block; background-color: #007bff; color: white; padding: 12px 25px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; text-align: center; text-decoration: none; transition: background-color 0.3s ease; }
        .btn:hover { background-color: #0056b3; }
        .flash { padding: 15px; margin-bottom: 20px; border: 1px solid transparent; border-radius: 4px; }
        .flash-error { color: #721c24; background-color: #f8d7da; border-color: #f5c6cb; }
        .flash-success { color: #155724; background-color: #d4edda; border-color: #c3e6cb; }
        .flash-info { color: #0c5460; background-color: #d1ecf1; border-color: #bee5eb; }
        .pandoc-check { text-align: center; margin-top: 20px; padding: 10px; border-radius: 4px;}
        .pandoc-ok { background-color: #d4edda; color: #155724; }
        .pandoc-fail { background-color: #f8d7da; color: #721c24; font-weight: bold;}
        pre { background-color: #eee; padding: 10px; border-radius: 4px; white-space: pre-wrap; word-wrap: break-word; } /* Style for error details */
    </style>
</head>
<body>
    <div class="container">
        <h1>Markdown to Professional DOCX</h1>
        {% with messages = get_flashed_messages(with_categories=true) %}
          {% if messages %}
            {% for category, message in messages %}
              <div class="flash flash-{{ category }}">
                {% if category == 'error_details' %}
                  <strong>Pandoc Details:</strong><pre>{{ message }}</pre>
                {% else %}
                  {{ message }}
                {% endif %}
              </div>
            {% endfor %}
          {% endif %}
        {% endwith %}
        <form method="post">
            <label for="markdown_input">Paste your Markdown here (supports GFM, LaTeX Math: $, $$, \\(, \\[, etc.):</label>
            <textarea id="markdown_input" name="markdown_input" required>{{ form_input or '' }}</textarea>
            <button type="submit" class="btn">Convert and Download DOCX</button>
        </form>
        <div class="pandoc-check {{ 'pandoc-ok' if pandoc_available else 'pandoc-fail' }}">
            {% if pandoc_available %}
                Pandoc check: OK (Found at '{{ PANDOC_PATH }}')
            {% else %}
                Pandoc check: FAILED! Pandoc command '{{ PANDOC_PATH }}' not found or not executable. Please install Pandoc and ensure it's in your system PATH or update PANDOC_PATH in the script.
            {% endif %}
        </div>
         <p style="font-size: smaller; color: #666; text-align:center; margin-top: 15px;">Supports GFM features, tables, and LaTeX Math (e.g., $`\\sqrt{x^2}`$, $$`\\int f(x)dx`$$, \\(`\\alpha`\\), \\[`E=mc^2`\\])</p>
    </div>
</body>
</html>
"""

# --- Routes ---
@app.route('/', methods=['GET', 'POST'])
def index():
    pandoc_available = check_pandoc()
    # Get potential input from form (for preserving across requests/errors)
    # Use request.form which holds POST data, falling back to empty string
    form_input = request.form.get('markdown_input', '')

    if request.method == 'POST':
        if not pandoc_available:
            flash('Pandoc is not configured correctly. Cannot convert.', 'error')
            # Return the template, preserving the user's input
            return render_template_string(HTML_TEMPLATE, pandoc_available=pandoc_available, PANDOC_PATH=PANDOC_PATH, form_input=form_input)

        markdown_text = form_input # Use the value already retrieved
        if not markdown_text:
            flash('No Markdown content provided.', 'info')
            return render_template_string(HTML_TEMPLATE, pandoc_available=pandoc_available, PANDOC_PATH=PANDOC_PATH, form_input=form_input) # Pass empty input back

        # Use context managers for safer temp file handling
        try:
            with tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False, encoding='utf-8', dir=app.config['UPLOAD_FOLDER']) as md_file:
                md_path = md_file.name
                md_file.write(markdown_text)

            # Create placeholder for docx path (file will be created by Pandoc)
            with tempfile.NamedTemporaryFile(suffix='.docx', delete=False, dir=app.config['UPLOAD_FOLDER']) as docx_file_placeholder:
                 docx_path = docx_file_placeholder.name
            # We don't write to docx_path yet, Pandoc will do that.

            # --- *** CRITICAL PANDOC COMMAND MODIFICATION *** ---
            # Added 'tex_math_single_backslash' to the input format (-f)
            # This enables parsing of \(...\) and \[...\] style LaTeX math.
            # Combined with 'tex_math_dollars' ($...$ and $$...$$) and '--mathml' output,
            # this ensures proper conversion to Word equations.
            cmd = [
                PANDOC_PATH,
                '-f', 'markdown+tex_math_dollars+tex_math_single_backslash+table_captions+yaml_metadata_block+pipe_tables+strikeout+superscript+subscript+task_lists', # Enable common GFM features + both math types
                '-t', 'docx',
                '--mathml',       # Output math as MathML (best for modern Word)
                '-s',             # Create a standalone document
                '-o', docx_path,  # Output file path
                md_path           # Input file path
            ]
            print(f"Running command: {' '.join(cmd)}") # Debugging line

            # Run Pandoc, capture output, use UTF-8
            result = subprocess.run(cmd, capture_output=True, text=True, check=False, encoding='utf-8', errors='replace')

            if result.returncode != 0:
                # Log full error to server console
                print(f"Pandoc Error Output:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
                # Flash user-friendly messages
                flash(f'Error during conversion: Pandoc failed (Code {result.returncode}).', 'error')
                if result.stderr:
                    # Flash stderr details separately for better formatting
                     flash(f'{result.stderr.strip()}', 'error_details') # Use a specific category if needed
                # Re-render template, preserving input
                return render_template_string(HTML_TEMPLATE, pandoc_available=pandoc_available, PANDOC_PATH=PANDOC_PATH, form_input=markdown_text)
            else:
                # Success! Send the file
                 # Add a success flash message
                flash('Conversion successful!', 'success')
                return send_file(
                    docx_path,
                    mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    as_attachment=True,
                    download_name='converted_document.docx'
                )

        except Exception as e:
            print(f"An unexpected server error occurred: {e}") # Log the full error
            flash(f'An unexpected server error occurred. Please check server logs.', 'error') # User-friendly message
            # Re-render template, preserving input
            return render_template_string(HTML_TEMPLATE, pandoc_available=pandoc_available, PANDOC_PATH=PANDOC_PATH, form_input=markdown_text)

        finally:
            # Clean up temporary files if they exist
            if 'md_path' in locals() and os.path.exists(md_path):
                try:
                    os.remove(md_path)
                except OSError as e:
                    print(f"Error removing temp md file {md_path}: {e}")
            # Don't remove docx_path here if send_file was successful,
            # Flask/Werkzeug might handle it, or it will be cleaned by OS eventually.
            # If send_file failed or an error occurred before it, we might want to clean docx_path.
            # However, leaving it for OS cleanup is often simpler in temp dirs.
            # If the conversion failed (returncode != 0), we should clean up the (potentially empty/corrupt) docx file
            if 'result' in locals() and result.returncode != 0 and 'docx_path' in locals() and os.path.exists(docx_path):
                 try:
                    os.remove(docx_path)
                 except OSError as e:
                    print(f"Error removing temp docx file {docx_path} after error: {e}")


    # GET request or if POST encountered an error before processing
    return render_template_string(HTML_TEMPLATE, pandoc_available=pandoc_available, PANDOC_PATH=PANDOC_PATH, form_input=form_input)


# --- Run the App ---
if __name__ == '__main__':
    if not check_pandoc():
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print(f"! WARNING: Pandoc command '{PANDOC_PATH}' not found or not executable!")
        print("! Please install Pandoc from https://pandoc.org/installing.html")
        print("! and ensure it's in your system PATH, or update the PANDOC_PATH variable.")
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
    # Added host/port for clarity, debug=True enables auto-reload
    app.run(debug=True, host='0.0.0.0', port=5000)