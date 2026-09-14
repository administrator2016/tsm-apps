#!/usr/bin/env python3
"""
inject_l1qr_panel.py
=====================
Automatically inserts the L1 Quick Reference panel into your existing
l1-ticket-copilot.html file. You do NOT need to manually copy/paste
anything - this script does it for you.

HOW TO USE (step by step):

1. Make sure you have Python 3 installed. Check by running:
       python3 --version
   (If that fails, try just "python --version" instead - use whichever
   works in the commands below.)

2. Put these two files in the SAME folder on your computer:
       - inject_l1qr_panel.py   (this script)
       - l1-quick-reference-panel.html   (the panel code)

3. Open a terminal (Command Prompt / PowerShell / Terminal app) and
   navigate to that folder, e.g.:
       cd path/to/that/folder

4. Run the script, pointing it at your actual l1-ticket-copilot.html
   file wherever it lives in your tsm-apps repo on your machine:

       python3 inject_l1qr_panel.py "/path/to/tsm-apps/html/l1-copilot/l1-ticket-copilot.html"

   Example on Windows:
       python3 inject_l1qr_panel.py "C:\\Users\\YourName\\tsm-apps\\html\\l1-copilot\\l1-ticket-copilot.html"

   Example on Mac/Linux:
       python3 inject_l1qr_panel.py "/Users/YourName/tsm-apps/html/l1-copilot/l1-ticket-copilot.html"

5. The script will:
       - make a backup copy of your original file (adds ".bak")
       - insert the panel's style/HTML/script right before </body>
       - tell you it succeeded, or tell you exactly what went wrong

6. Open l1-ticket-copilot.html in a browser (or reload it if your dev
   server is already running) - you should see a "Quick Reference"
   button. Click it to confirm the panel opens.

7. Commit the change in git like you normally would:
       git add html/l1-copilot/l1-ticket-copilot.html
       git commit -m "Add L1 Quick Reference panel"
       git push

SAFE TO RUN MULTIPLE TIMES:
If you run this script again on a file that already has the panel
in it, it detects the marker comment and skips re-inserting a
duplicate copy - it will just tell you it's already present.

TO REMOVE IT LATER:
Everything this script inserts is wrapped between these two HTML
comment markers:
    <!-- L1QR-PANEL-START -->
    ... (all inserted code) ...
    <!-- L1QR-PANEL-END -->
You (or this script's --remove option, see below) can delete
everything between those two lines to take the panel back out
cleanly, with nothing left behind.

Run with --remove to undo:
    python3 inject_l1qr_panel.py "/path/to/l1-ticket-copilot.html" --remove
"""

import sys
import os
import re

START_MARKER = "<!-- L1QR-PANEL-START -->"
END_MARKER = "<!-- L1QR-PANEL-END -->"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    remove_mode = "--remove" in sys.argv

    if len(args) != 1:
        print("Usage:")
        print('  python3 inject_l1qr_panel.py "/path/to/l1-ticket-copilot.html"')
        print('  python3 inject_l1qr_panel.py "/path/to/l1-ticket-copilot.html" --remove')
        sys.exit(1)

    target_path = args[0]

    if not os.path.isfile(target_path):
        print(f'ERROR: Could not find file at "{target_path}".')
        print("Double check the path is correct and try again.")
        sys.exit(1)

    with open(target_path, "r", encoding="utf-8") as f:
        target_html = f.read()

    already_present = START_MARKER in target_html

    if remove_mode:
        if not already_present:
            print("Nothing to remove - the panel marker was not found in this file.")
            sys.exit(0)
        pattern = re.compile(
            re.escape(START_MARKER) + r".*?" + re.escape(END_MARKER),
            re.DOTALL,
        )
        new_html = pattern.sub("", target_html)
        backup_and_write(target_path, target_html, new_html)
        print("Removed the Quick Reference panel from the file.")
        sys.exit(0)

    if already_present:
        print("The Quick Reference panel is already present in this file - nothing to do.")
        print("(If you want to update it, run with --remove first, then run this again.)")
        sys.exit(0)

    panel_source_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "l1-quick-reference-panel.html")
    if not os.path.isfile(panel_source_path):
        print(f'ERROR: Could not find "l1-quick-reference-panel.html" next to this script.')
        print("Make sure both files are in the same folder, then try again.")
        sys.exit(1)

    with open(panel_source_path, "r", encoding="utf-8") as f:
        panel_code = f.read().strip()

    injected_block = f"\n{START_MARKER}\n{panel_code}\n{END_MARKER}\n"

    if "</body>" in target_html:
        new_html = target_html.replace("</body>", injected_block + "</body>", 1)
    else:
        # No </body> tag found (unusual, but handle it) - just append to the end.
        print('WARNING: No "</body>" tag found in the file - appending the panel to the end instead.')
        new_html = target_html + injected_block

    backup_and_write(target_path, target_html, new_html)

    print("Success! The Quick Reference panel has been added.")
    print(f"A backup of your original file was saved as: {target_path}.bak")
    print("Reload l1-ticket-copilot.html in your browser and look for the 'Quick Reference' button.")


def backup_and_write(target_path, original_content, new_content):
    backup_path = target_path + ".bak"
    with open(backup_path, "w", encoding="utf-8") as f:
        f.write(original_content)
    with open(target_path, "w", encoding="utf-8") as f:
        f.write(new_content)


if __name__ == "__main__":
    main()
