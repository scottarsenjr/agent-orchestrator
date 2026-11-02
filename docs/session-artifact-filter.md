# Session artifacts

The Artifacts list shows documents, reports, spreadsheets and images from the
session artifact directory. File types include Markdown, HTML, PDF, text, CSV,
TSV, Excel, Word, PowerPoint and common image formats. Generated dependencies,
Python environments, application packages and build directories are skipped.
Filtering does not delete files; HTML reports can still load their own assets.

To publish a file of another type, create or update `.ao-artifacts.json` at the
root of that session's artifact directory:

```json
{"include": ["release.zip", "scripts/deploy.ps1"]}
```

Paths are relative to the session artifact directory. Files must be in that
directory, not symlinks, and outside excluded technical directories. The same
list controls artifact version capture and the files shared in session handoff.
Existing file contents and previous versions are not removed by this filter.
