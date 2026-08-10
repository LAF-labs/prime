---
name: summarize-docs
description: Reading a document for the user — summarizing a report, pulling key points from a PDF or Word file, comparing several, or finding what a contract says.
---

# Summarizing documents

A summary is trusted more than it is checked. Someone will act on this without
opening the file, so everything in it has to come from the file.

## 1. Read the whole thing first

`read_file` handles PDF, Word (.docx) and Excel (.xlsx) as well as plain text —
open the file, do not reason from its name.

**If the result ends with a note that it was cut off, you have part of the
document, not all of it.** Say so in your answer, in one sentence, and be
specific about what you did read ("the first ~15 pages"). A summary of the
first half presented as a summary of the whole is the worst thing this skill
can produce.

For several documents, read them all before writing anything. A comparison
written after the first file gets rewritten after the third.

## 2. Write it in this shape

- **Three lines first.** What this document is, and the two things that matter
  most in it. Someone who reads only this should not be misled.
- **Then the detail**, grouped the way the document is — by section, by date,
  by party. Keep the document's own terms for names, amounts, and dates.
- **Then what to do**, if anything: decisions waiting, deadlines, who owes
  what. Skip this heading when the document asks nothing of the reader.

Numbers, dates, names, and amounts are copied, never rounded and never
restated from memory. If the document contradicts itself, say so rather than
picking the version that reads better.

## 3. Mark what is not in the document

If the user asks something the document does not answer, say it is not in
there. Do not fill the gap from general knowledge and leave the user thinking
they read it in their own file.

Quote sparingly, and only when the exact wording carries the meaning — a clause
in a contract, a figure in a table.

## 4. When you cannot read it

Some formats cannot be opened yet, and a PDF made of scanned pages has no text
in it at all. `read_file` says which case it is. Pass that on in plain words
along with what would work — usually re-saving or exporting as PDF or .docx —
instead of guessing at the contents.

## 5. Saving it

Only write a file when the user asks for one. When they do, `write_file` a
Markdown file next to the document it summarizes, and tell them where it is.
