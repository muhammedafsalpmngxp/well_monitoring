"""The run's reports: an Excel workbook (every affected record, streamed from the spool) and a Word document (the
narrative a person reads end to end). Both are built from the same rows and helpers (format.py) so they cannot
disagree, and each is returned as bytes - the runtime keeps no file."""
